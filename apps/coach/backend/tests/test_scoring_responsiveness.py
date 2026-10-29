import asyncio
import threading
import unittest
from unittest.mock import patch

import httpx
from app.main import app


class ScoringResponsiveness(unittest.IsolatedAsyncioTestCase):
    async def test_scoring_does_not_block_playback_api(self):
        entered = threading.Event()
        release = threading.Event()
        def analyze(_data):
            entered.set()
            release.wait(timeout=2)
            return {'contour': [], 'notes': []}
        with patch('app.main.songs.reference', return_value={}), patch('app.main.pitch.analyze', side_effect=analyze), patch('app.main.scoring.score', return_value={'overall': 0}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                task = asyncio.create_task(client.post('/songs/test/score', files={'file': ('take.webm', b'audio')}))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                    self.assertFalse(task.done(), 'Scoring should still be running independently')
                    health = await asyncio.wait_for(client.get('/health'), timeout=.5)
                    self.assertEqual(health.json(), {'status': 'ok'})
                finally:
                    release.set()
                    response = await task
                self.assertEqual(response.status_code, 200)


if __name__ == '__main__':
    unittest.main()
