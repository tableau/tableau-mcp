declare module 'probe-image-size/sync.js' {
  type ProbeResult = {
    width: number;
    height: number;
    type: string;
  };

  function probeImageSize(data: Buffer): ProbeResult | null;

  export = probeImageSize;
}
