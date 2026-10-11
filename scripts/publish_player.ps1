# Builds the shareable player into publish\: the page (without the document skeleton, which the host adds),
# player.js, the song and the audio envelopes. Run from the dreams folder: powershell -File scripts\publish_player.ps1
$ErrorActionPreference = 'Stop'
npx vite build
if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }
New-Item -ItemType Directory -Force publish | Out-Null
$html = Get-Content player.html -Raw -Encoding utf8
$a = $html.IndexOf('<!--PUBLISH-START-->') + '<!--PUBLISH-START-->'.Length
$b = $html.IndexOf('<!--PUBLISH-END-->')
$page = $html.Substring($a, $b - $a).Replace('<script type="module" src="/src/thoughts/main.ts"></script>', '<script type="module" src="player.js"></script>')
Set-Content publish\within-one-voice.html $page.Trim() -Encoding utf8
Copy-Item dist-player\player.js publish\player.js -Force
Copy-Item public\song.mp3 publish\song.mp3 -Force
Copy-Item public\envelopes.json publish\envelopes.json -Force
Get-ChildItem publish | Select-Object Name, Length
