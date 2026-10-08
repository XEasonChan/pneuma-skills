"""Where the scripts run: a workstation (macOS or Linux), or a Linux container (TL_HOSTED=1, a /data volume). The platform defaults live
here so every script resolves them the same way; an explicit env var always wins.

  hosted        TL_HOSTED=1 (set by the image)          data dir: $TL_DATA_DIR, else /data
  whisper model $WHISPER_MODEL, else $TL_WHISPER_MODEL, else <models>/ggml-large-v3.bin
                <models> = /data/models (hosted or Linux) | ~/.cache/hyperframes/whisper/models (macOS)
  whisper-cli   $TL_WHISPER_CLI, else PATH, else /opt/homebrew/bin/whisper-cli (macOS)
  delivery dir  hosted: /data/deliveries · else ~/LaunchStudio/deliveries (pass --to / TL_DELIVERY_DIR to change it)"""
import os, shutil, sys


def truthy(v):
    return str(v or '').strip().lower() in ('1', 'true', 'yes', 'on')


def is_mac():
    return sys.platform == 'darwin'


def is_hosted():
    return truthy(os.environ.get('TL_HOSTED'))


def data_dir():
    return os.environ.get('TL_DATA_DIR') or '/data'


LOCAL_DELIVERY = os.path.expanduser('~/LaunchStudio/deliveries')
MAC_WHISPER_MODELS = os.path.expanduser('~/.cache/hyperframes/whisper/models')


def whisper_models_dir():
    return os.path.join(data_dir(), 'models') if (is_hosted() or not is_mac()) else MAC_WHISPER_MODELS


def whisper_model_setting():
    """the configured model (a path or a size name like large-v3 / small), or None for the default"""
    return os.environ.get('WHISPER_MODEL') or os.environ.get('TL_WHISPER_MODEL') or None


def whisper_model(arg=None):
    """-> (path or None, where it was looked for). `arg` (a path or a size name) wins over the env and the default."""
    m = arg or whisper_model_setting() or 'large-v3'
    if os.path.isfile(m): return m, m
    if os.sep in m or m.endswith('.bin'): return None, m                    # an explicit path that is not there
    p = os.path.join(whisper_models_dir(), f'ggml-{m}.bin')
    return (p if os.path.isfile(p) else None), p


def whisper_cli():
    """the whisper.cpp CLI, or None"""
    c = os.environ.get('TL_WHISPER_CLI')
    if c: return c if os.path.exists(c) else None
    c = shutil.which('whisper-cli')
    if c: return c
    if is_mac() and os.path.exists('/opt/homebrew/bin/whisper-cli'): return '/opt/homebrew/bin/whisper-cli'
    return None


def delivery_default():
    """the delivery folder when neither --to, TL_DELIVERY_DIR nor film.json settings.deliveryDir names one (None = no default here)"""
    if is_hosted(): return os.path.join(data_dir(), 'deliveries')
    return LOCAL_DELIVERY
