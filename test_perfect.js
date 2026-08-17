const youtubedl = require('youtube-dl-exec');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testPerfectAudio() {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const outputTemplate = path.join(__dirname, 'temp', 'perfect_320_%(ext)s');
  
  console.log('Downloading best audio with dynamic audio normalization & 320k studio quality...');
  await youtubedl(url, {
    format: 'bestaudio/best',
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: '320K',
    postprocessorArgs: '-codec:a libmp3lame -b:a 320k -q:a 0 -ar 44100 -af dynaudnorm=p=0.95:m=10',
    noPlaylist: true,
    noWarnings: true,
    noCheckCertificates: true,
    ffmpegLocation: ffmpeg.path,
    output: outputTemplate,
    extractorArgs: 'youtube:player_client=all',
  });

  const files = fs.readdirSync(path.join(__dirname, 'temp')).filter(f => f.startsWith('perfect_320'));
  console.log('Generated files:', files);
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

testPerfectAudio().catch(console.error);
