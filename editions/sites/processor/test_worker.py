import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import requests
from worker import Worker

class TransportTest(unittest.TestCase):
    def worker(self):
        return Worker({'site_url':'http://127.0.0.1:9999','worker_token':'test-only','ffmpeg':'/usr/bin/ffmpeg','ffprobe':'/usr/bin/ffprobe','node':'/usr/bin/node'})

    @patch('worker.time.sleep')
    @patch('worker.requests.Session')
    def test_upload_retries_with_write_timeout(self, session, sleep):
        response = MagicMock(ok=True,is_redirect=False,status_code=200)
        response.json.return_value = {'ok':True}
        session.return_value.request.side_effect = [requests.Timeout(), requests.ConnectionError(), response]
        result = self.worker().request('jobs/test/frames/f_0000.jpg','PUT',raw=b'jpeg')
        self.assertEqual(result,{'ok':True})
        self.assertEqual(session.return_value.request.call_count,3)
        self.assertEqual(session.return_value.request.call_args.kwargs['timeout'],(60,90))
        self.assertFalse(session.return_value.request.call_args.kwargs['allow_redirects'])

    @patch('worker.requests.Session')
    def test_claim_is_never_retried_after_uncertain_response(self, session):
        session.return_value.request.side_effect = requests.Timeout()
        with self.assertRaises(RuntimeError): self.worker().request('claim',data={})
        self.assertEqual(session.return_value.request.call_count,1)

    @patch('worker.run')
    def test_browser_compatible_mov_does_not_need_second_large_upload(self, run):
        run.return_value = json.dumps({'streams':[{'codec_type':'video','codec_name':'h264'},{'codec_type':'audio','codec_name':'aac'}]}).encode()
        worker=self.worker(); worker.current={'filename':'phone.MOV'}
        worker.request=MagicMock()
        worker.playback(Path('/tmp/input'),Path('/tmp'), 'jobs/test/')
        self.assertEqual(run.call_count,1)
        worker.request.assert_not_called()

if __name__ == '__main__': unittest.main()
