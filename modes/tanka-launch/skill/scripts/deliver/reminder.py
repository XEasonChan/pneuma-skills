#!/usr/bin/env python3
"""Reminder hook (STUB): records the reminder the delivery wants and prints what to do; it does not create one yet.

  python3 deliver/reminder.py --ws DIR --title "Launch film · final" [--due 2026-10-05T09:00] [--note "…"]

Writes out/deliver/reminder.json {title, due, note, status: "stubbed"} and prints a JSON line. No task-manager integration is
bundled: the director hands the producer the reminder text (or sets it with whatever tool the producer uses) after the final OK, and
marks it done here (status "set"). To wire a task manager in, POST the task here (title, due date, content = the note), record the
task id, and keep this script's interface unchanged."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--title', required=True); ap.add_argument('--due'); ap.add_argument('--note', default='')
    a = ap.parse_args(); ws = W.ws_root(a.ws)
    rec = dict(title=a.title, due=a.due, note=a.note, status='stubbed', created=W.now_iso(),
               todo='no task-manager hook: hand the producer the reminder text, then set status "set"')
    p = W.jwrite(W.P(ws, 'out', 'deliver', 'reminder.json'), rec)
    print(json.dumps(dict(reminder=W.rel(ws, p), status='stubbed', title=a.title, due=a.due)))


if __name__ == '__main__': main()
