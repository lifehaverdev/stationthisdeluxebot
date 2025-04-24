/**
 * Test Media Files Fixture
 * 
 * Mock media files for testing media-related commands
 */

const testMediaFiles = [
  // Images
  {
    id: 'img-001',
    name: 'vacation-photo.jpg',
    mediaType: 'image',
    mimeType: 'image/jpeg',
    fileSize: 1024000,
    userId: 'user-001',
    createdAt: new Date('2023-01-15').toISOString(),
    updatedAt: new Date('2023-01-15').toISOString(),
    path: '/storage/images/user-001/vacation-photo.jpg'
  },
  {
    id: 'img-002',
    name: 'profile-picture.png',
    mediaType: 'image',
    mimeType: 'image/png',
    fileSize: 512000,
    userId: 'user-001',
    createdAt: new Date('2023-02-20').toISOString(),
    updatedAt: new Date('2023-02-20').toISOString(),
    path: '/storage/images/user-001/profile-picture.png'
  },
  {
    id: 'img-003',
    name: 'screenshot.png',
    mediaType: 'image',
    mimeType: 'image/png',
    fileSize: 756000,
    userId: 'user-001',
    createdAt: new Date('2023-03-05').toISOString(),
    updatedAt: new Date('2023-03-05').toISOString(),
    path: '/storage/images/user-001/screenshot.png'
  },
  
  // Audio files
  {
    id: 'aud-001',
    name: 'podcast-episode.mp3',
    mediaType: 'audio',
    mimeType: 'audio/mpeg',
    fileSize: 15360000,
    userId: 'user-001',
    createdAt: new Date('2023-01-25').toISOString(),
    updatedAt: new Date('2023-01-25').toISOString(),
    path: '/storage/audio/user-001/podcast-episode.mp3'
  },
  {
    id: 'aud-002',
    name: 'voice-memo.m4a',
    mediaType: 'audio',
    mimeType: 'audio/m4a',
    fileSize: 4096000,
    userId: 'user-001',
    createdAt: new Date('2023-02-15').toISOString(),
    updatedAt: new Date('2023-02-15').toISOString(),
    path: '/storage/audio/user-001/voice-memo.m4a'
  },
  
  // Video files
  {
    id: 'vid-001',
    name: 'tutorial.mp4',
    mediaType: 'video',
    mimeType: 'video/mp4',
    fileSize: 42000000,
    userId: 'user-001',
    createdAt: new Date('2023-01-10').toISOString(),
    updatedAt: new Date('2023-01-10').toISOString(),
    path: '/storage/videos/user-001/tutorial.mp4'
  },
  {
    id: 'vid-002',
    name: 'family-celebration.mov',
    mediaType: 'video',
    mimeType: 'video/quicktime',
    fileSize: 128000000,
    userId: 'user-001',
    createdAt: new Date('2023-03-20').toISOString(),
    updatedAt: new Date('2023-03-20').toISOString(),
    path: '/storage/videos/user-001/family-celebration.mov'
  }
];

module.exports = {
  testMediaFiles
}; 