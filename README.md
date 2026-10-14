# Repeater Nation Feed

Streams audio from a **sound card, line-in or SDR** into a **stream channel** (a listen-only channel) so everyone on the radio can listen to it.

## How a stream channel comes about

1. A member signs in to the Feed app and sends a request: a name and what the audio is.
2. The request shows up in the Control console on the **Streams** tab. A controller picks the zone and approves it (or turns it down with a reason).
3. Approval creates a listen-only channel in that zone and makes the member its owner. The member picks it in the Feed app and starts the feed.

Admins can also connect a feed to any listen-only channel, and can set a channel or zone to listen only in the console's Channels tab.

## The desktop app (Windows, Linux)

Sign in, pick the channel and the audio input, press **Start the feed**.

- **Input:** any sound device. For an SDR, run SDR#, SDR++ or SDRangel, send its audio to a virtual audio cable (VB-Cable on Windows, a PulseAudio null sink on Linux) and pick the cable here.
- **Squelch:** audio goes out only while there is a signal, so listeners see "on air" only when something is actually coming through. Move the squelch level (the orange line on the meter) just above the noise. "All the time" sends continuously, which suits a weather-radio feed.
- **Start by itself when this app opens** is for a computer that runs the feed unattended.

## The command line (Raspberry Pi, any always-on computer)

Needs Node 20 or newer. Unpack `repeater-nation-feed-cli.tar.gz`, run `npm install` inside it, then:

```
# List the channels you can feed
FEED_EMAIL=you@example.com FEED_PASSWORD=... node feed-cli.mjs --list

# An RTL-SDR dongle (needs rtl-sdr installed): NOAA weather radio, sent all the time
rtl_fm -f 162.55M -M fm -s 24000 -l 0 | node feed-cli.mjs --channel "NOAA Weather" --stdin --rate 24000 --always

# A scanner or radio on the sound card (needs ffmpeg), squelched
node feed-cli.mjs --channel "Sheriff" --ffmpeg-input "-f alsa -i default" --threshold 0.03
```

The tool prints the input level every ten seconds so you can pick a squelch level. It reconnects by itself and gets a fresh feed connection every 23 hours. To keep it running across reboots, run it from a systemd service.

## Notes

- Feed connections are made by the server (`radio-feed`) and last 24 hours; the app and the command line renew them on their own.
- Sign-in is by email and password. If your own account uses Google sign-in, make a separate account for feeds.
- Not yet tested against the live server or with real hardware.
