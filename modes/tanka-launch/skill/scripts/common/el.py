"""ElevenLabs client (stdlib urllib; request shapes from the public ElevenLabs API reference).
Every function here is a PAID call: callers wrap it in paid.Paid(ws, stage).call(...) (reserve -> call -> commit) and branch to
their mock stand-in first. The key comes from env ELEVENLABS_API_KEY and is never printed.

  tts(voice_id, text, out, settings, lang, model='eleven_v3', seed=None)    POST /v1/text-to-speech/{voice_id}   (mp3_44100_128)
  video_to_music(video, out_pcm, description, tags, model_id)             POST /v1/music/video-to-music       (multipart; <=2 concurrent)
  compose(plan|prompt, out, model_id, length_ms)                          POST /v1/music                       (composition_plan)
  sound(text, out, duration_s, prompt_influence)                          POST /v1/sound-generation
Gotchas: eleven_v3 ignores `speed`; the account allows 128 kbps mp3 (192 needs Creator); music_v1 is the API default and is
deprecated (always pass model_id); V2M scores the picture in one pass and doesn't land on cuts (the SFX carry the cuts)."""
import json, os
import paid

API = 'https://api.elevenlabs.io'


def _h(ct='application/json'):
    return {'xi-api-key': paid.key('elevenlabs'), 'Content-Type': ct, 'Accept': '*/*'}


def tts(voice_id, text, out, settings, lang=None, model='eleven_v3', seed=None, fmt='mp3_44100_128'):
    if str(voice_id).startswith('REPLACE_'):
        raise SystemExit(f'voice id {voice_id} is an example placeholder: set real voice ids in scripts/common/voices.json first')
    body = dict(text=text, model_id=model, voice_settings=settings)
    if lang: body['language_code'] = lang
    if seed is not None: body['seed'] = seed
    st, h, data = paid.http('POST', f'{API}/v1/text-to-speech/{voice_id}?output_format={fmt}', _h(), json.dumps(body).encode(), timeout=180)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'wb') as f: f.write(data)
    return dict(request_id=paid.el_request_id(h), character_cost=h.get('character-cost') or h.get('x-character-count'))


def video_to_music(video, out_pcm, description=None, tags=(), model_id='music_v2_5', fmt='pcm_44100'):
    fields = [('model_id', model_id)]
    if description: fields.append(('description', description[:1000]))
    for t in list(tags)[:10]: fields.append(('tags', t))
    body, ct = paid.multipart(fields, [('videos', video, 'video/mp4')])
    st, h, data = paid.http('POST', f'{API}/v1/music/video-to-music?output_format={fmt}', _h(ct), body, timeout=900)
    with open(out_pcm, 'wb') as f: f.write(data)
    return dict(request_id=paid.el_request_id(h), song_id=h.get('song-id'))


def compose(out, composition_plan=None, prompt=None, model_id='music_v2_5', length_ms=None, fmt='mp3_44100_128', seed=None):
    body = dict(model_id=model_id)
    if composition_plan is not None: body['composition_plan'] = composition_plan
    else:
        body['prompt'] = prompt; body['force_instrumental'] = True
        if length_ms: body['music_length_ms'] = int(length_ms)
    if seed is not None: body['seed'] = seed
    st, h, data = paid.http('POST', f'{API}/v1/music?output_format={fmt}', _h(), json.dumps(body).encode(), timeout=900)
    with open(out, 'wb') as f: f.write(data)
    return dict(request_id=paid.el_request_id(h), song_id=h.get('song-id'))


def sound(text, out, duration_s=None, prompt_influence=0.4, fmt='mp3_44100_128'):
    body = dict(text=text, model_id='eleven_text_to_sound_v2', prompt_influence=prompt_influence)
    if duration_s: body['duration_seconds'] = max(0.5, min(30.0, float(duration_s)))
    st, h, data = paid.http('POST', f'{API}/v1/sound-generation?output_format={fmt}', _h(), json.dumps(body).encode(), timeout=300)
    with open(out, 'wb') as f: f.write(data)
    return dict(request_id=paid.el_request_id(h))
