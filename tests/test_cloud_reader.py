import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cloud_reader


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        config = Path(self.temp.name) / 'credential.json'
        config.write_text(json.dumps({'id': 'test-device', 'token': 'a' * 64}))
        with patch.object(cloud_reader, 'CONFIG', config):
            self.reader = cloud_reader.CloudReader('https://example.invalid', 'public', {'connected': True})

    def reply(self, cd, resolved=True, ack=None):
        return io.BytesIO(json.dumps({'ack': ack or self.reader.event['id'], 'resolved': resolved, 'cd': cd}).encode())

    def test_scan_ack_response_and_relink(self):
        self.reader.scan('01:02:03:04')
        with patch.object(cloud_reader, 'urlopen', return_value=self.reply(None, False)):
            self.reader.exchange()
        self.assertIsNone(self.reader.take_result())
        with patch.object(cloud_reader, 'urlopen', return_value=self.reply(None)):
            self.reader.exchange()
        self.assertEqual(self.reader.take_result(), {'uid': '01:02:03:04', 'cd': None})
        cd = {'id': 'album', 'tracks': []}
        with patch.object(cloud_reader, 'urlopen', return_value=self.reply(cd)):
            self.reader.exchange()
        self.assertEqual(self.reader.take_result()['cd'], cd)
        with patch.object(cloud_reader, 'urlopen', return_value=self.reply(cd)):
            self.reader.exchange()
        self.assertIsNone(self.reader.take_result())

    def test_stale_reply_does_not_display(self):
        self.reader.scan('01:02:03:04')
        old = self.reader.event['id']
        self.reader.scan('05:06:07:08')
        with patch.object(cloud_reader, 'urlopen', return_value=self.reply({'id': 'old'}, ack=old)):
            self.reader.exchange()
        self.assertIsNone(self.reader.take_result())

    def test_failure_retains_scan_for_retry(self):
        self.reader.scan('01:02:03:04')
        event = self.reader.event.copy()
        with patch.object(cloud_reader, 'urlopen', side_effect=OSError('offline')):
            with self.assertRaises(OSError): self.reader.exchange()
        self.assertEqual(self.reader.event, event)


if __name__ == '__main__': unittest.main()
