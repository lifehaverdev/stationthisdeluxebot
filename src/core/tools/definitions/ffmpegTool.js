const ffmpegTool = {
  toolId: 'ffmpeg',
  service: 'ffmpeg',
  version: '1.0.0',
  displayName: 'FFmpeg',
  commandName: '/ffmpeg',
  apiPath: '/ffmpeg/process',
  description: 'Video processing — concatenate clips, add transitions, and more.',

  inputSchema: {
    mode: {
      name: 'Mode',
      type: 'enum',
      required: true,
      description: 'Processing mode',
      enum: ['concat'],
      order: 0
    },
    videos: {
      name: 'Videos',
      type: 'video',
      required: true,
      description: 'Video URLs to process. Accepts batch inputs.',
      order: 1
    },
    transition: {
      name: 'Transition',
      type: 'enum',
      required: false,
      description: 'Transition between clips',
      enum: ['none', 'crossfade', 'fade-to-black'],
      visibleIf: { field: 'mode', values: ['concat'] },
      order: 2
    },
    outputFormat: {
      name: 'Output Format',
      type: 'enum',
      required: false,
      description: 'Output video format',
      enum: ['mp4', 'webm'],
      order: 3
    },
  },
  outputSchema: {
    video: {
      name: 'video',
      type: 'video',
      description: 'The processed video.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0.05,
      unit: 'request'
    }
  },
  deliveryMode: 'async',
  platformHints: {
    primaryInput: 'video',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'video-to-video',
  visibility: 'public',
  metadata: {
    provider: 'Local',
    model: 'ffmpeg',
    outputType: 'video',
    inputType: 'video',
  }
};

module.exports = ffmpegTool;
