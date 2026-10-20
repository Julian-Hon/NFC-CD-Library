"""Account-scoped Supabase relay for the USB reader; no account password needed."""
import getpass
import json
import threading
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'local_data' / 'reader-credential.json'


def pair():
    # Hidden input avoids leaving the credential in shell history/process args.
    value = getpass.getpass('Paste the reader credential from the website: ').strip()
    identifier, token = value.split(':', 1)
    uuid.UUID(identifier)
    if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
        raise ValueError('Invalid reader credential')
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps({'id': identifier, 'token': token}), encoding='utf-8')
    print('Reader credential saved in ignored local_data. Revoke it on the website if this computer is lost.')


class CloudReader:
    def __init__(self, url, key, reader_state):
        self.config = json.loads(CONFIG.read_text(encoding='utf-8'))
        self.url, self.key, self.reader_state = url, key, reader_state
        self.lock = threading.Lock()
        self.event = None
        self.result = None
        self.delivered = None

    def scan(self, uid):
        with self.lock:
            self.event = {'id': str(uuid.uuid4()), 'uid': uid}
            self.result = None

    def take_result(self):
        with self.lock:
            value, self.result = self.result, None
            return value

    def exchange(self):
        with self.lock:
            event = self.event.copy() if self.event else None
        body = {'reader_id': self.config['id'], 'device_token': self.config['token'],
                'is_connected': self.reader_state['connected'],
                'event_id': event['id'] if event else None, 'tag_uid': event['uid'] if event else None}
        request = Request(self.url + '/rest/v1/rpc/reader_exchange', data=json.dumps(body).encode(),
                          headers={'apikey': self.key, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=8) as response:
            data = json.load(response)
        with self.lock:
            if event and self.event == event and data.get('ack') == event['id'] and data.get('resolved'):
                # Allow a new tag to be resolved again after the website saves it.
                signature = (event['id'], json.dumps(data.get('cd'), sort_keys=True))
                if signature != self.delivered:
                    self.result = {'uid': event['uid'], 'cd': data.get('cd')}
                    self.delivered = signature

    def run(self):
        failed = False
        while True:
            try:
                self.exchange()
                if failed:
                    print('Cloud reader connection restored.', flush=True)
                failed = False
            except Exception:
                if not failed:
                    print('Cloud reader unavailable: check internet, migration, or pair again if revoked.', flush=True)
                failed = True
            time.sleep(2)
