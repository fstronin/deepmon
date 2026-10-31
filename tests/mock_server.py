#!/usr/bin/env python3
"""Mock DeepSeek API для тестов адаптера: /<scenario>/user/balance."""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / 'fixtures'


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        parts = self.path.strip('/').split('/')
        scenario = parts[0] if parts else 'ok'

        if scenario == 'slow':
            time.sleep(2)
            scenario = 'ok'
        if scenario == 'unauthorized':
            return self._raw(401, json.dumps({'error': 'unauthorized'}))
        if scenario == 'ratelimit':
            return self._raw(429, json.dumps({'error': 'rate limit'}))
        if scenario == 'server-error':
            return self._raw(500, json.dumps({'error': 'boom'}))
        if scenario == 'broken':
            return self._raw(200, '{oops')

        name = 'balance-multi.json' if scenario == 'multi' else 'balance-cny.json'
        return self._raw(200, (FIXTURES / name).read_text())

    def _raw(self, status, text):
        body = text.encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18087
    ttl = float(sys.argv[2]) if len(sys.argv) > 2 else 30.0
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    threading.Timer(ttl, server.shutdown).start()
    print(f'listening {port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
