#!/usr/bin/env python3
"""Swap a film's audio without re-rendering the picture: the video stream is copied, the audio replaced (AAC 192k).

  scripts/py mix/remux.py --video out/picture/short-16x9-ja.mp4 --audio out/roughcut/short-16x9-ja.wav --out out/roughcut/short-16x9-ja.mp4

The audio is padded / trimmed to the picture's exact duration first (frames / fps), so the audio length rounds to the same frame
count. Verifies: frame count unchanged, audio duration within half a frame of the picture, LUFS / true peak read back after AAC.
(An .m4a input is stream-copied instead of re-encoded.)"""
import argparse, json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W


def video_info(p):
    j = W.ffprobe(p); v = [s for s in j['streams'] if s['codec_type'] == 'video'][0]
    num, den = (v.get('r_frame_rate') or '30/1').split('/'); fps = float(num) / float(den)
    frames = W.count_frames(p); return dict(frames=frames, fps=fps, dur=frames / fps if frames else float(j['format']['duration']), width=v.get('width'), height=v.get('height'))


def remux(video, audio, out):
    vi = video_info(video); os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = None
    if audio.endswith('.m4a'):
        acodec = ['-c:a', 'copy']; src = audio
    else:
        tmp = tempfile.mktemp(suffix='.m4a', dir=os.path.dirname(os.path.abspath(out)))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', audio, '-af', f"apad,atrim=0:{vi['dur']:.6f}", '-c:a', 'aac', '-b:a', '192k', tmp], check=True)
        src = tmp; acodec = ['-c:a', 'copy']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-i', src, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', *acodec, '-movflags', '+faststart', out], check=True)
    if tmp and os.path.exists(tmp): os.remove(tmp)
    vo = video_info(out); j = W.ffprobe(out); a = [s for s in j['streams'] if s['codec_type'] == 'audio']
    ad = float(a[0].get('duration') or 0) if a else 0.0
    rec = dict(out=out, frames_in=vi['frames'], frames_out=vo['frames'], frames_match=vi['frames'] == vo['frames'], video_s=round(vi['dur'], 4), audio_s=round(ad, 4),
               audio_frames=round(ad * vi['fps'], 2), audio_matches=abs(ad - vi['dur']) <= 0.5 / vi['fps'] + 0.03, **W.ebur128(out))
    if not rec['frames_match']: raise SystemExit(f'remux changed the frame count: {rec}')
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--video', required=True); ap.add_argument('--audio', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args(); ws = W.ws_root(a.ws); rp = lambda p: p if os.path.isabs(p) else os.path.join(ws, p)
    rec = remux(rp(a.video), rp(a.audio), rp(a.out)); rec['out'] = W.rel(ws, rec['out']); print(json.dumps(rec))


if __name__ == '__main__': main()
