"""Copy the existing paired reader credential into ESP32 Preferences over USB.

The credential is read from ignored local_data and is never printed or passed
as a command-line argument. Close the USB bridge and Serial Monitor first.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def credential(path):
    data = json.loads(path.read_text(encoding='utf-8'))
    reader_id, token = data.get('id', ''), data.get('token', '')
    if not re.fullmatch(r'[0-9a-fA-F-]{36}', reader_id) or not re.fullmatch(r'[0-9a-f]{64}', token):
        raise ValueError('Saved reader credential is invalid. Pair again on the website.')
    return reader_id, token


def provision(port, path):
    import serial
    reader_id, token = credential(path)
    with serial.Serial(port, 115200, timeout=1, write_timeout=5) as device:
        # Opening this port resets many ESP32 boards. Wait for setup to finish.
        time.sleep(3)
        device.reset_input_buffer()
        device.write(f'PAIR {reader_id}:{token}\n'.encode('ascii'))
        device.flush()
        until = time.monotonic() + 10
        while time.monotonic() < until:
            line = device.readline().decode('utf-8', errors='replace').strip()
            if line == 'Reader paired for direct Wi-Fi scans':
                print('ESP32 paired. The credential is saved on the board.')
                return
            if line == 'Reader credential invalid':
                raise RuntimeError('ESP32 rejected the credential.')
        raise TimeoutError('ESP32 did not confirm pairing. Check the port and uploaded firmware.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='COM3', help='ESP32 USB port (default: COM3)')
    parser.add_argument('--credential', type=Path, default=ROOT / 'local_data' / 'reader-credential.json')
    arguments = parser.parse_args()
    try:
        provision(arguments.port, arguments.credential)
    except (OSError, ValueError, RuntimeError, TimeoutError) as error:
        print(f'Pairing failed: {error}', file=sys.stderr)
        raise SystemExit(1)
