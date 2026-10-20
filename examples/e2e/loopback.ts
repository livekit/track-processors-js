import type { LoopbackControl, LoopbackStatsSample } from './types';

/**
 * A peer connection wired to itself, inside the page.
 *
 * Several cases are about what reaches the *encoder*, not what reaches a canvas, and those two
 * can disagree: a canvas keeps painting while nothing is being published, which is the whole
 * shape of #127. A loopback answers that without a LiveKit server — `pc1` sends the published
 * track to `pc2` in the same tab, and `pc2`'s inbound-rtp stats report the frame size and rate
 * actually being decoded at the far end.
 *
 * Deliberately not the `room.ts` path: this needs no server, no token and no network, so it can
 * run in the ordinary suite. Suite L's real two-browser cases still want a room.
 */
export class Loopback implements LoopbackControl {
  private pc1?: RTCPeerConnection;

  private pc2?: RTCPeerConnection;

  private inbound?: MediaStreamTrack;

  isConnected() {
    return this.pc1?.connectionState === 'connected' && this.pc2?.connectionState === 'connected';
  }

  /** Publish `track` through a self-connected pair and resolve once frames are decoding. */
  async start(track: MediaStreamTrack, timeoutMs = 15_000): Promise<void> {
    await this.stop();

    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();
    this.pc1 = pc1;
    this.pc2 = pc2;

    // No STUN and no network: host candidates on both ends resolve against each other.
    pc1.addEventListener('icecandidate', (e) => {
      if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => undefined);
    });
    pc2.addEventListener('icecandidate', (e) => {
      if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => undefined);
    });

    const inbound = new Promise<MediaStreamTrack>((resolve) => {
      pc2.addEventListener('track', (e) => resolve(e.track));
    });

    pc1.addTrack(track, new MediaStream([track]));

    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);

    this.inbound = await inbound;

    // Connected is not enough: stats read zero until the decoder has produced a frame, and a
    // case that samples too early measures the warm-up rather than the pipeline.
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const sample = await this.stats();
      if (sample && sample.framesDecoded > 0 && sample.frameWidth) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Loopback never decoded a frame');
  }

  /**
   * Inbound-rtp stats from the receiving end, i.e. what a remote peer would see.
   *
   * `frameWidth`/`frameHeight` ramp: the encoder starts small and scales up over the first
   * seconds, so an early read of a 1280x720 source measures 320x180. The *ratio* is right from
   * the first frame, the absolute size is not — wait for it to settle before asserting on size.
   */
  async stats(): Promise<LoopbackStatsSample | null> {
    if (!this.pc2) return null;
    const report = await this.pc2.getStats();
    let out: LoopbackStatsSample | null = null;
    report.forEach((s: any) => {
      if (s.type !== 'inbound-rtp' || s.kind !== 'video') return;
      out = {
        framesDecoded: s.framesDecoded ?? 0,
        framesReceived: s.framesReceived ?? 0,
        framesPerSecond: s.framesPerSecond ?? null,
        frameWidth: s.frameWidth ?? null,
        frameHeight: s.frameHeight ?? null,
      };
    });
    return out;
  }

  /**
   * Mean decoded fps over `windowMs`, measured from the frame counter rather than read from
   * `framesPerSecond` — the reported value is a short rolling average and lags a stall.
   */
  async measure(
    windowMs = 3000,
  ): Promise<{ fps: number; framesDecoded: number; elapsedMs: number }> {
    const first = await this.stats();
    if (!first) throw new Error('No loopback stats; call start() first');
    const startedAt = performance.now();
    await new Promise((r) => setTimeout(r, windowMs));
    const last = await this.stats();
    const elapsedMs = performance.now() - startedAt;
    const framesDecoded = (last?.framesDecoded ?? 0) - first.framesDecoded;
    return { fps: (framesDecoded * 1000) / elapsedMs, framesDecoded, elapsedMs };
  }

  async stop(): Promise<void> {
    this.pc1?.close();
    this.pc2?.close();
    this.pc1 = undefined;
    this.pc2 = undefined;
    this.inbound = undefined;
  }

  /** The decoded track at the receiving end, for probing what a remote peer actually gets. */
  receivedTrack(): MediaStreamTrack | undefined {
    return this.inbound;
  }
}
