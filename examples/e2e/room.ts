import { Room, RoomEvent } from 'livekit-client';
import type { Media } from './media';
import type { Config, RoomControl, SenderStatsSample } from './types';

/**
 * The optional publishing path.
 *
 * Most of the suite needs no server. The visibility cases do: a hidden tab throttles the
 * probe's own video element, so `requestVideoFrameCallback` cannot tell "the pipeline froze"
 * apart from "the probe stopped being painted". Only a real encoder can, which is what
 * `measure()` reads. Cross-browser interop needs a room too.
 */
export class RoomMode implements RoomControl {
  private room?: Room;

  private published = false;

  constructor(
    private config: Config,
    private media: Media,
    private log: (message: string) => void,
  ) {}

  isConnected() {
    return this.room?.state === 'connected';
  }

  snapshot() {
    if (!this.room) return null;
    return {
      connected: this.isConnected(),
      name: this.room.name || null,
      published: this.published,
    };
  }

  async connect(url = this.config.url, token = this.config.token) {
    if (!url || !token) {
      throw new Error('Room mode needs ?url= and ?token=; most cases do not need a room at all');
    }
    const room = new Room({ adaptiveStream: false, dynacast: false });
    room.on(RoomEvent.Disconnected, () => {
      this.published = false;
      this.log('room disconnected');
    });
    await room.connect(url, token);
    this.room = room;
    this.log(`room connected: ${room.name}`);
  }

  async disconnect() {
    await this.room?.disconnect();
    this.room = undefined;
    this.published = false;
  }

  async publish() {
    if (!this.room) throw new Error('Not connected. Call room.connect() first.');
    const { videoTrack, audioTrack } = this.media;
    if (!videoTrack && !audioTrack) throw new Error('Nothing to publish. Start the camera first.');

    if (videoTrack) await this.room.localParticipant.publishTrack(videoTrack);
    if (audioTrack) await this.room.localParticipant.publishTrack(audioTrack);
    this.published = true;
    this.log('published local tracks');
  }

  async unpublish() {
    if (!this.room) return;
    const { videoTrack, audioTrack } = this.media;
    if (videoTrack) await this.room.localParticipant.unpublishTrack(videoTrack);
    if (audioTrack) await this.room.localParticipant.unpublishTrack(audioTrack);
    this.published = false;
  }

  /**
   * Prefers the raw RTCStatsReport because `framesEncoded` is the liveness signal and
   * `VideoSenderStats` does not carry it. Falls back to the typed helper.
   */
  async senderStats(): Promise<SenderStatsSample | null> {
    const track = this.media.videoTrack;
    if (!track || !this.published) return null;

    const report = await track.getRTCStatsReport().catch(() => undefined);
    if (report) {
      let best: SenderStatsSample | null = null;
      report.forEach((entry: any) => {
        if (entry.type !== 'outbound-rtp' || entry.kind !== 'video') return;
        const sample: SenderStatsSample = {
          framesEncoded: entry.framesEncoded ?? 0,
          framesSent: entry.framesSent ?? 0,
          framesPerSecond: entry.framesPerSecond ?? null,
          frameWidth: entry.frameWidth ?? null,
          frameHeight: entry.frameHeight ?? null,
          qualityLimitationReason: entry.qualityLimitationReason,
        };
        // Simulcast reports one entry per layer; the highest is the one under test.
        if (!best || sample.framesEncoded > best.framesEncoded) best = sample;
      });
      if (best) return best;
    }

    const typed = await track.getSenderStats().catch(() => []);
    const layer = typed.sort((a, b) => (b.framesSent ?? 0) - (a.framesSent ?? 0))[0];
    if (!layer) return null;
    return {
      framesEncoded: layer.framesSent ?? 0,
      framesSent: layer.framesSent ?? 0,
      framesPerSecond: layer.framesPerSecond ?? null,
      frameWidth: layer.frameWidth ?? null,
      frameHeight: layer.frameHeight ?? null,
      qualityLimitationReason: layer.qualityLimitationReason,
    };
  }

  async measure(windowMs: number) {
    const first = await this.senderStats();
    if (!first) throw new Error('No sender stats; connect and publish first');
    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const second = await this.senderStats();
    const elapsed = performance.now() - startedAt;
    const delta = (second?.framesEncoded ?? 0) - first.framesEncoded;
    return { fps: (delta * 1000) / elapsed, framesEncodedDelta: delta };
  }
}
