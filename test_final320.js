const youtubedl = require('youtube-dl-exec');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testFinal320() {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const outputTemplate = path.join(__dirname, 'temp', 'final320_%(ext)s');
  
  await youtubedl(url, {
    format: '251/bestaudio/best',
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '320K',
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    ffmpegLocation: ffmpeg.path,
    output: outputTemplate,
    extractorArgs: 'youtube:player_client=all',
  });

  const files = fs.readdirSync(path.join(__dirname, 'temp')).filter(f => f.startsWith('final320'));
  console.log('Files:', files);
  for (const f of files) {
    const fullPath = path.join(__dirname, 'temp', f);
    try {
      execSync(`"${ffmpeg.path}" -i "${fullPath}"`, { stdio: 'pipe' });
    } catch (e) {
      const log = e.stderr.toString();
      const lines = log.split('\n').filter(l => l.includes('Stream #') || l.includes('Duration'));
      console.log('DETAILS:\n' + lines.join('\n'));
    }
    fs.unlinkSync(fullPath);
  }
}

testFinal320().catch(console.error);
