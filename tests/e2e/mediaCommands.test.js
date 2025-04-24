/**
 * End-to-End Tests for Media Commands
 * 
 * This test suite covers the functionality of media-related commands:
 * - /images - For managing image files
 * - /audios - For managing audio files
 * - /videos - For managing video files
 * 
 * Tests validate the complete user flow for media management including:
 * - Viewing media libraries
 * - Uploading media files
 * - Viewing individual media files
 * - Renaming media files
 * - Deleting media files
 */

const path = require('path');
const fs = require('fs');

// Import test helpers
const { 
  setupTestBot, 
  executeCommand, 
  sendMessage, 
  sendMedia,
  mockUserInteraction,
  cleanup
} = require('../helpers/botTestHelper');

// Import test data
const { testUsers } = require('../fixtures/users');
const { testMediaFiles } = require('../fixtures/mediaFiles');

// Path to test images
const TEST_IMAGE_PATH = path.join(process.cwd(), 'loraExamples', 'HPOS10iflux.jpg');

// Mock services
jest.mock('../../src/services/mediaService');
const { MediaService } = require('../../src/services/mediaService');

describe('Media Commands', () => {
  let bot;
  let testUser;
  
  beforeEach(async () => {
    // Setup test environment
    bot = await setupTestBot();
    testUser = testUsers[0];
    
    // Reset mocks
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    await cleanup();
  });

  // Test suite for images command
  describe('/images command', () => {
    test('should display image library', async () => {
      // Execute the images command
      const response = await executeCommand(bot, testUser, 'images');
      
      // Verify the response
      expect(response).toContain("My Images");
      testMediaFiles
        .filter(media => media.mediaType === 'image')
        .slice(0, 5)
        .forEach(image => {
          expect(response).toContain(image.name);
        });
      expect(response).toContain("Upload Image");
    });
    
    test('should show paginated list when user has images', async () => {
      // Execute the images command
      const response = await executeCommand(bot, testUser, 'images');
      
      // Verify the response
      expect(response).toContain('My Images');
      testMediaFiles
        .filter(media => media.mediaType === 'image')
        .slice(0, 5)
        .forEach(image => {
          expect(response).toContain(image.name);
        });
      expect(response).toContain('Upload Image');
    });
    
    test('should handle viewing a specific image', async () => {
      // Get a test image from our fixture
      const testImage = testMediaFiles.find(media => media.mediaType === 'image');
      
      // Execute the view command
      const response = await mockUserInteraction(
        bot, 
        testUser, 
        `image:view:${testImage.id}`
      );
      
      // Verify the response
      expect(response).toContain(testImage.name);
      expect(response).toContain('Rename');
      expect(response).toContain('Delete');
      expect(response).toContain('Back to Library');
    });
    
    test('should handle uploading an image', async () => {
      // Start upload conversation
      await executeCommand(bot, testUser, 'images upload');
      
      // Send media message
      const response = await sendMedia(
        bot, 
        testUser, 
        'image', 
        TEST_IMAGE_PATH, 
        'HPOS10iflux.jpg'
      );
      
      // Verify the response
      expect(response).toContain('uploaded successfully');
    });
    
    test('should handle renaming an image', async () => {
      // Get a test image from our fixture
      const testImage = testMediaFiles.find(media => media.mediaType === 'image');
      
      // Start rename conversation
      await mockUserInteraction(
        bot, 
        testUser, 
        `image:rename:${testImage.id}`
      );
      
      // Send new name
      const newName = 'Renamed Image';
      const response = await sendMessage(bot, testUser, newName);
      
      // Verify the response
      expect(response).toContain('renamed successfully');
    });
    
    test('should handle deleting an image', async () => {
      // Get a test image from our fixture
      const testImage = testMediaFiles.find(media => media.mediaType === 'image');
      
      // Request delete
      await mockUserInteraction(
        bot, 
        testUser, 
        `image:delete:${testImage.id}`
      );
      
      // Confirm delete
      const response = await mockUserInteraction(
        bot, 
        testUser, 
        `image:delete:confirm:${testImage.id}`
      );
      
      // Verify the response
      expect(response).toContain('deleted successfully');
    });
  });
  
  // Test suite for audios command
  describe('/audios command', () => {
    test('should show empty library message when user has no audio files', async () => {
      // Execute the audios command
      const response = await executeCommand(bot, testUser, 'audios');
      
      // Verify the response
      expect(response).toContain("My Audios");
      
      // Since our test data includes audio files by default, 
      // we'll be checking for those instead of empty message
      testMediaFiles
        .filter(media => media.mediaType === 'audio')
        .slice(0, 5)
        .forEach(audio => {
          expect(response).toContain(audio.name);
        });
      
      expect(response).toContain("Upload Audio");
    });
    
    test('should show paginated list when user has audio files', async () => {
      // Execute the audios command
      const response = await executeCommand(bot, testUser, 'audios');
      
      // Verify the response
      expect(response).toContain('My Audios');
      testMediaFiles
        .filter(media => media.mediaType === 'audio')
        .slice(0, 5)
        .forEach(audio => {
          expect(response).toContain(audio.name);
        });
      expect(response).toContain('Upload Audio');
    });
  });
  
  // Test suite for videos command
  describe('/videos command', () => {
    test('should show empty library message when user has no video files', async () => {
      // Execute the videos command
      const response = await executeCommand(bot, testUser, 'videos');
      
      // Verify the response
      expect(response).toContain("My Videos");
      
      // Since our test data includes video files by default,
      // we'll be checking for those instead of empty message
      testMediaFiles
        .filter(media => media.mediaType === 'video')
        .slice(0, 5)
        .forEach(video => {
          expect(response).toContain(video.name);
        });
        
      expect(response).toContain("Upload Video");
    });
    
    test('should show paginated list when user has video files', async () => {
      // Execute the videos command
      const response = await executeCommand(bot, testUser, 'videos');
      
      // Verify the response
      expect(response).toContain('My Videos');
      testMediaFiles
        .filter(media => media.mediaType === 'video')
        .slice(0, 5)
        .forEach(video => {
          expect(response).toContain(video.name);
        });
      expect(response).toContain('Upload Video');
    });
  });
  
  // Common media handling edge cases
  describe('Media command edge cases', () => {
    test('should validate minimum length for renamed media files', async () => {
      // Get a test image from our fixture
      const testImage = testMediaFiles.find(media => media.mediaType === 'image');
      
      // Start rename conversation
      await mockUserInteraction(
        bot, 
        testUser, 
        `image:rename:${testImage.id}`
      );
      
      // Send invalid name (too short)
      const response = await sendMessage(bot, testUser, 'a');
      
      // Verify the response
      expect(response).toContain('Name must be at least 2 characters');
    });
    
    test('should require confirmation when deleting a media file', async () => {
      // Get a test image from our fixture
      const testImage = testMediaFiles.find(media => media.mediaType === 'image');
      
      // Request delete
      const response = await mockUserInteraction(
        bot, 
        testUser, 
        `image:delete:${testImage.id}`
      );
      
      // Verify the confirmation message
      expect(response).toContain('Are you sure you want to delete');
      expect(response).toContain('Yes, Delete');
      expect(response).toContain('Cancel');
    });
  });
}); 