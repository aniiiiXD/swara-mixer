"""Regression checks for the app-owned downloader and single-video imports."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from stemcore.ingest.youtube import download_audio


class DownloadTest(unittest.IsolatedAsyncioTestCase):
    async def check_download(self, has_module):
        url = 'https://www.youtube.com/watch?v=dZ1o4KM4NJc&list=RDdZ1o4KM4NJc&start_radio=1'
        meta = AsyncMock()
        meta.communicate.return_value = (json.dumps({'title': 'Song', 'duration': 71}).encode(), b'')
        meta.returncode = 0
        download = AsyncMock()
        download.stdout = asyncio.StreamReader()
        download.stdout.feed_data(b'[download] 100% of audio\n')
        download.stdout.feed_eof()
        download.returncode = 0
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, 'audio.wav').touch()
            with (
                patch('stemcore.ingest.youtube.importlib.util.find_spec', return_value=object() if has_module else None),
                patch('stemcore.ingest.youtube.shutil.which', side_effect=lambda name: f'/system/bin/{name}'),
                patch('stemcore.ingest.youtube.asyncio.create_subprocess_exec', side_effect=[meta, download]) as spawn,
            ):
                result = await download_audio(url, temp)
            self.assertEqual(result.title, 'Song')
            self.assertEqual(result.duration, 71)
            expected = [sys.executable, '-m', 'yt_dlp'] if has_module else ['/system/bin/yt-dlp']
            self.assertEqual(len(spawn.call_args_list), 2)
            for call in spawn.call_args_list:
                self.assertEqual(list(call.args[:len(expected)]), expected)
                self.assertIn('--no-playlist', call.args)
                self.assertEqual(call.args[-1], url)

    async def test_application_dependency_wins_over_global_executable(self):
        await self.check_download(has_module=True)

    async def test_lightweight_install_can_use_external_executable(self):
        await self.check_download(has_module=False)


if __name__ == '__main__':
    unittest.main()
