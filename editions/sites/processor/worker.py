#!/usr/bin/env python3
"""Freejira companion. Polls outbound HTTPS; requires no inbound port on the Mac."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import queue
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import requests
from video_core import SYSTEM_PROMPT, ordered_inputs, prepare_frames, probe, run, validate_result

ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / 'result.schema.json').read_text())


class Codex:
    def __init__(self, executable, directory):
        self.proc = subprocess.Popen([executable, '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"', 'app-server', '--listen', 'stdio://'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd=directory)
        self.events = queue.Queue(); self.seq = 0; self.usage = {}; self.final = ''; self.completed = None
        def read():
            for line in self.proc.stdout:
                try: self.events.put(json.loads(line))
                except json.JSONDecodeError: pass
            self.events.put({'worker_eof': True})
        threading.Thread(target=read, daemon=True).start()
        self.call('initialize', {'clientInfo': {'name': 'freejira_video', 'title': 'Freejira — задачи из видео', 'version': '1.0.0'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized'})

    def send(self, value):
        self.proc.stdin.write(json.dumps(value, ensure_ascii=False) + '\n'); self.proc.stdin.flush()

    def event(self, timeout=180):
        item = self.events.get(timeout=timeout)
        if item.get('worker_eof'):
            raise RuntimeError('Codex завершился без результата. Проверьте вход и лимиты подписки')
        # No tool execution or approvals are needed for an image/text analysis.
        if 'method' in item and 'id' in item:
            self.send({'id': item['id'], 'error': {'code': -32601, 'message': 'Tools and approvals are disabled for video analysis'}})
        if item.get('method') == 'item/completed':
            data = item.get('params', {}).get('item', {})
            if data.get('type') == 'agentMessage' and data.get('phase') in (None, 'final_answer'):
                self.final = data.get('text', '')
        if item.get('method') == 'turn/completed':
            self.completed = item['params']['turn']
        if item.get('method') == 'thread/tokenUsage/updated':
            total = item['params'].get('tokenUsage', {}).get('total', {})
            self.usage = {'input_tokens': total.get('inputTokens', 0), 'output_tokens': total.get('outputTokens', 0), 'cached_input_tokens': total.get('cachedInputTokens', 0)}
        return item

    def call(self, method, params, timeout=30):
        self.seq += 1; ident = self.seq; self.send({'id': ident, 'method': method, 'params': params})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            item = self.event(max(.1, deadline - time.monotonic()))
            if item.get('id') == ident:
                if 'error' in item: raise RuntimeError(f"Codex: {item['error'].get('message', 'ошибка запроса')}")
                return item['result']
        raise TimeoutError('Codex не ответил вовремя')

    def analyze(self, inputs, directory):
        thread = self.call('thread/start', {'cwd': str(directory), 'ephemeral': True, 'approvalPolicy': 'never', 'sandbox': 'read-only', 'baseInstructions': SYSTEM_PROMPT, 'developerInstructions': 'Analyze only the supplied images and speech. No tools. Return only the requested JSON.', 'config': {'features.shell_tool': False, 'web_search': 'disabled'}})
        self.call('turn/start', {'threadId': thread['thread']['id'], 'input': inputs, 'outputSchema': SCHEMA, 'approvalPolicy': 'never', 'sandboxPolicy': {'type': 'readOnly'}})
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if not self.completed: self.event(max(.1, deadline - time.monotonic()))
            if self.completed:
                turn = self.completed
                if turn['status'] != 'completed': raise RuntimeError('Codex не завершил разбор: ' + str((turn.get('error') or {}).get('message', turn['status']))[:500])
                return json.loads(self.final), self.usage
        raise TimeoutError('Codex не завершил разбор за 4 минуты. Повторите попытку')

    def close(self):
        self.proc.terminate()
        try: self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired: self.proc.kill(); self.proc.wait()


class Worker:
    def __init__(self, config):
        self.config = config; self.stop = threading.Event(); self.current = None; self.stage = 'transcription'; self.progress = 10
        self.local = threading.local()
        self.base = config['site_url'].rstrip('/') + '/api/video/worker/'
        if not self.base.startswith('https://') and not self.base.startswith('http://127.0.0.1:'):
            raise ValueError('Нужен HTTPS адрес Freejira')
        self.headers = {'Authorization': 'Bearer ' + config['worker_token']}
        if config.get('site_access_token'): self.headers['OAI-Sites-Authorization'] = 'Bearer ' + config['site_access_token']
        os.environ['PATH'] = str(Path(config['ffmpeg']).parent) + os.pathsep + str(Path(config['node']).parent) + os.pathsep + os.environ.get('PATH', '')

    def request(self, path, method='POST', data=None, raw=None, stream=False, lease=True):
        headers = dict(self.headers)
        if lease and self.current: headers['X-Video-Lease'] = self.current['lease']
        # Redirects must not forward the companion secrets to an authentication page or another host.
        if not hasattr(self.local, 'session'): self.local.session = requests.Session()
        attempts = 3 if method in ('GET', 'PUT') else 1
        for attempt in range(attempts):
            try:
                # requests uses the connection timeout while writing a request body, too.
                # An 8 MiB part may take over 15 seconds on a home uplink.
                result = self.local.session.request(method, self.base + path, headers=headers, json=data if raw is None else None, data=raw, timeout=(60 if raw is not None else 15, 90), allow_redirects=False, stream=stream)
                if result.status_code not in (429, 502, 503, 504) or attempt == attempts - 1: break
                result.close()
            except requests.RequestException as error:
                if attempt == attempts - 1:
                    raise RuntimeError('Ошибка сети при передаче ' + ('видео' if 'playback' in path else 'кадра' if '/frames/' in path else 'данных') + '. Повторите разбор, когда соединение восстановится') from error
            time.sleep(2 * (attempt + 1))
        if not result.ok or result.is_redirect:
            if result.status_code == 409: raise RuntimeError('Аренда задания истекла. Оно будет повторено другим запуском')
            try: error = result.json().get('error', '')
            except (ValueError, AttributeError): error = ''
            raise RuntimeError(f'Freejira HTTP {result.status_code}: {error[:400]}')
        return result if stream else result.json()

    def heartbeat(self):
        while not self.stop.is_set():
            try:
                status = subprocess.run([self.config['codex'], 'login', 'status'], capture_output=True, timeout=15)
                ready = status.returncode == 0
                self.request('heartbeat', data={'name': 'Mac · ' + os.uname().nodename, 'ready': ready, 'message': '' if ready else 'Нужно войти в Codex на Mac'}, lease=False)
                if self.current: self.request(f"jobs/{self.current['id']}/progress", data={'status': self.stage, 'progress': self.progress})
            except Exception as error: print('heartbeat:', str(error)[:300], flush=True)
            self.stop.wait(20)

    def playback(self, original, directory, prefix):
        info = json.loads(run([self.config['ffprobe'], '-v', 'error', '-show_format', '-show_streams', '-of', 'json', original], 30))
        video = next(s for s in info['streams'] if s['codec_type'] == 'video')
        audio = next((s for s in info['streams'] if s['codec_type'] == 'audio'), None)
        if video.get('codec_name') == 'h264' and (not audio or audio.get('codec_name') == 'aac') and self.current['filename'].lower().endswith(('.mp4', '.mov')):
            return
        output = directory / 'playback.mp4'
        codec = ['-c:v', 'copy'] if video.get('codec_name') == 'h264' else ['-vf', "scale=w='min(1568,iw)':h='min(1568,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'h264_videotoolbox', '-b:v', '2500k', '-pix_fmt', 'yuv420p']
        run([self.config['ffmpeg'], '-nostdin', '-v', 'error', '-i', original, '-map', '0:v:0', '-map', '0:a:0?', *codec, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output], 300)
        if output.stat().st_size > 500 * 1024 * 1024: raise ValueError('Копия видео для браузера больше 500 МБ. Уменьшите качество исходника')
        upload_id = self.request(prefix + 'playback/start', data={})['upload_id']
        from urllib.parse import quote
        try:
            parts = []
            with output.open('rb') as source:
                while chunk := source.read(8 * 1024 * 1024):
                    parts.append(self.request(prefix + f'playback/parts/{len(parts)+1}?upload_id={quote(upload_id, safe="")}', 'PUT', raw=chunk))
            self.request(prefix + 'playback/complete', data={'upload_id': upload_id, 'parts': parts})
        except Exception:
            try: self.request(prefix + 'playback/abort', data={'upload_id': upload_id})
            except Exception: pass
            raise

    def process(self, job):
        self.current = job; self.stage = 'transcription'; self.progress = 10; start = time.monotonic(); metrics = {'provider': 'Codex · подписка ChatGPT + локальный MLX Whisper'}
        prefix = f"jobs/{job['id']}/"
        try:
            with tempfile.TemporaryDirectory(prefix='freejira-video-', dir=self.config.get('temp_dir')) as temp:
                directory = Path(temp); original = directory / 'input.video'
                response = self.request(prefix + 'media', 'GET', stream=True)
                sha = hashlib.sha256(); total = 0
                with original.open('wb') as file:
                    for chunk in response.iter_content(1024 * 1024):
                        total += len(chunk)
                        if total > 500 * 1024 * 1024: raise ValueError('Видео больше 500 МБ')
                        file.write(chunk); sha.update(chunk)
                response.close()
                if total != job['size']: raise ValueError('Видео скачано не полностью')
                mark = time.monotonic(); duration, has_audio = probe(original, self.config['ffprobe'])
                self.request(prefix + 'metadata', data={'sha256': sha.hexdigest(), 'duration': duration, 'has_audio': has_audio})
                metrics['metadata_seconds'] = round(time.monotonic() - mark, 2)
                transcript = []; mark = time.monotonic()
                if has_audio:
                    audio = directory / 'audio.wav'
                    run([self.config['ffmpeg'], '-nostdin', '-v', 'error', '-i', original, '-vn', '-ac', '1', '-ar', '16000', audio])
                    import mlx_whisper
                    result = mlx_whisper.transcribe(str(audio), path_or_hf_repo=self.config.get('whisper_model', 'mlx-community/whisper-large-v3-turbo'), language='ru', verbose=False, condition_on_previous_text=False)
                    transcript = [{'start': max(0, float(s['start'])), 'end': min(duration, float(s['end'])), 'text': s['text'].strip()} for s in result.get('segments', []) if s['text'].strip() and s.get('no_speech_prob', 0) < .8 and float(s['start']) <= duration]
                metrics['transcription_seconds'] = round(time.monotonic() - mark, 2)
                self.stage = 'frames'; self.progress = 40; self.request(prefix + 'progress', data={'status': self.stage, 'progress': self.progress})
                mark = time.monotonic(); frames = prepare_frames(original, directory, self.config['ffmpeg'], job['settings'])
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                    list(pool.map(lambda f: self.request(prefix + 'frames/' + f['name'], 'PUT', raw=(directory / f['name']).read_bytes()), frames))
                metrics['frames_seconds'] = round(time.monotonic() - mark, 2)
                mark = time.monotonic(); self.playback(original, directory, prefix)
                metrics['playback_seconds'] = round(time.monotonic() - mark, 2)
                self.stage = 'analysis'; self.progress = 70; self.request(prefix + 'progress', data={'status': self.stage, 'progress': self.progress})
                inputs = ordered_inputs(job, frames, transcript, directory, duration); mark = time.monotonic()
                usage = {'input_tokens': 0, 'output_tokens': 0, 'cached_input_tokens': 0}
                for attempt in range(2):
                    codex = Codex(self.config['codex'], directory)
                    try:
                        result, used = codex.analyze(inputs, directory)
                        for key in usage: usage[key] += used.get(key, 0)
                        result = validate_result(result, SCHEMA, frames, duration, transcript, has_audio)
                        break
                    except (json.JSONDecodeError, ValueError, __import__('jsonschema').ValidationError) as error:
                        if attempt: raise ValueError('Модель дважды вернула некорректный результат. Уточните контекст и повторите разбор') from error
                        inputs.append({'type': 'text', 'text': 'Предыдущий ответ не прошёл проверку. Верни полный JSON заново. Ошибка: ' + str(error)[:800]})
                    finally: codex.close()
                metrics.update(usage); metrics['analysis_seconds'] = round(time.monotonic() - mark, 2); metrics['total_seconds'] = round(time.monotonic() - start, 2)
                self.request(prefix + 'complete', data={'result': result, 'frames': frames, 'transcript': transcript, 'metrics': metrics})
                print(json.dumps({'job': job['id'], 'status': 'ready', 'metrics': metrics}, ensure_ascii=False), flush=True)
        except Exception as error:
            metrics['total_seconds'] = round(time.monotonic() - start, 2)
            detail = f"{ {'transcription':'Расшифровка', 'frames':'Отбор кадров', 'analysis':'Анализ'}[self.stage]}: {str(error)[:850]}"
            try: self.request(prefix + 'error', data={'error': detail, 'metrics': metrics})
            except Exception: pass
            print(json.dumps({'job': job['id'], 'status': 'error', 'error': detail}, ensure_ascii=False), flush=True)
        finally: self.current = None

    def loop(self, once=False):
        threading.Thread(target=self.heartbeat, daemon=True).start()
        while not self.stop.is_set():
            try:
                status = subprocess.run([self.config['codex'], 'login', 'status'], capture_output=True, timeout=15)
                if status.returncode == 0:
                    job = self.request('claim', data={})['job']
                    if job: self.process(job)
                if once: return
            except Exception as error: print('queue:', str(error)[:300], flush=True)
            self.stop.wait(10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--config', required=True); parser.add_argument('--once', action='store_true'); args = parser.parse_args()
    worker = Worker(json.loads(Path(args.config).read_text()))
    for sig in (signal.SIGINT, signal.SIGTERM): signal.signal(sig, lambda *_: worker.stop.set())
    worker.loop(args.once)
