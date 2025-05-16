/**
 * Collections Workflow Integration Tests
 * 
 * Tests the functionality of the collections workflow, ensuring it properly
 * interacts with the database and session services.
 */

const { CollectionsWorkflow } = require('../../src/workflows/collections');

// Mock services
const mockSessionService = {
  getUserData: jest.fn().mockImplementation((userId) => {
    return Promise.resolve({ userId });
  }),
  updateUserData: jest.fn().mockImplementation((userId, data) => {
    return Promise.resolve({ ...data, userId });
  })
};

const mockMediaService = {
  processImage: jest.fn(),
  storeImage: jest.fn()
};

const mockCollectionDB = {
  getCollectionsByUserId: jest.fn(),
  createCollection: jest.fn(),
  loadCollection: jest.fn(),
  saveStudio: jest.fn(),
  deleteCollection: jest.fn()
};

const mockDB = {
  collections: mockCollectionDB
};

describe('Collections Workflow', () => {
  let workflow;
  const TEST_USER_ID = '5472638766'; // Per project specifications
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create workflow instance with mock services
    workflow = new CollectionsWorkflow({
      sessionService: mockSessionService,
      mediaService: mockMediaService,
      db: mockDB
    });
  });
  
  describe('getUserCollections', () => {
    it('should retrieve collections for a user', async () => {
      // Setup mock response
      const mockCollections = [
        { collectionId: '123', name: 'Collection 1', userId: TEST_USER_ID },
        { collectionId: '456', name: 'Collection 2', userId: TEST_USER_ID }
      ];
      
      mockCollectionDB.getCollectionsByUserId.mockResolvedValue(mockCollections);
      
      // Execute method
      const result = await workflow.getUserCollections(TEST_USER_ID);
      
      // Verify
      expect(mockCollectionDB.getCollectionsByUserId).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result).toEqual(mockCollections);
    });
    
    it('should handle errors when getting collections', async () => {
      // Setup mock error
      mockCollectionDB.getCollectionsByUserId.mockRejectedValue(new Error('Database error'));
      
      // Execute and verify
      await expect(workflow.getUserCollections(TEST_USER_ID))
        .rejects.toThrow('Failed to load collections');
    });
  });
  
  describe('createCollection', () => {
    it('should create a new collection', async () => {
      // Setup
      const collectionName = 'My New Collection';
      const options = { 
        size: 20,
        masterPrompt: 'Test prompt', 
        workflow: 'CUSTOM' 
      };
      
      mockCollectionDB.createCollection.mockResolvedValue(true);
      
      // Execute
      const result = await workflow.createCollection(TEST_USER_ID, collectionName, options);
      
      // Verify
      expect(mockCollectionDB.createCollection).toHaveBeenCalled();
      expect(mockSessionService.updateUserData).toHaveBeenCalled();
      expect(result).toMatchObject({
        name: collectionName,
        userId: TEST_USER_ID,
        size: options.size,
        config: {
          masterPrompt: options.masterPrompt,
          workflow: options.workflow
        }
      });
    });
    
    it('should handle failure during collection creation', async () => {
      // Setup
      mockCollectionDB.createCollection.mockResolvedValue(false);
      
      // Execute and verify
      await expect(workflow.createCollection(TEST_USER_ID, 'Test Collection'))
        .rejects.toThrow('Collection creation failed');
    });
  });
  
  describe('getCollection', () => {
    it('should retrieve a specific collection', async () => {
      // Setup
      const collectionId = '123';
      const mockCollection = { 
        collectionId,
        name: 'Test Collection',
        userId: TEST_USER_ID
      };
      
      mockCollectionDB.loadCollection.mockResolvedValue(mockCollection);
      
      // Execute
      const result = await workflow.getCollection(TEST_USER_ID, collectionId);
      
      // Verify
      expect(mockCollectionDB.loadCollection).toHaveBeenCalledWith(collectionId);
      expect(result).toEqual(mockCollection);
    });
    
    it('should throw error if collection not found', async () => {
      // Setup
      mockCollectionDB.loadCollection.mockResolvedValue(null);
      
      // Execute and verify
      await expect(workflow.getCollection(TEST_USER_ID, '123'))
        .rejects.toThrow('Collection not found');
    });
    
    it('should throw error if user does not own collection', async () => {
      // Setup
      const mockCollection = { 
        collectionId: '123',
        name: 'Test Collection',
        userId: 'different-user'
      };
      
      mockCollectionDB.loadCollection.mockResolvedValue(mockCollection);
      
      // Execute and verify
      await expect(workflow.getCollection(TEST_USER_ID, '123'))
        .rejects.toThrow('You do not have access to this collection');
    });
  });
  
  describe('updateCollection', () => {
    it('should update collection properties', async () => {
      // Setup
      const collectionId = '123';
      const mockCollection = { 
        collectionId,
        name: 'Original Name',
        status: 'incomplete',
        userId: TEST_USER_ID,
        config: {
          masterPrompt: 'Original prompt'
        }
      };
      
      const updates = {
        name: 'Updated Name',
        status: 'complete'
      };
      
      mockCollectionDB.loadCollection.mockResolvedValue(mockCollection);
      mockCollectionDB.saveStudio.mockResolvedValue(true);
      
      // Execute
      const result = await workflow.updateCollection(TEST_USER_ID, collectionId, updates);
      
      // Verify
      expect(mockCollectionDB.saveStudio).toHaveBeenCalled();
      expect(result).toMatchObject({
        ...mockCollection,
        ...updates,
        userId: TEST_USER_ID // Should not change
      });
    });
  });
  
  describe('deleteCollection', () => {
    it('should delete a collection', async () => {
      // Setup
      const collectionId = '123';
      const mockCollection = { 
        collectionId,
        name: 'Test Collection',
        userId: TEST_USER_ID
      };
      
      mockCollectionDB.loadCollection.mockResolvedValue(mockCollection);
      mockCollectionDB.deleteCollection.mockResolvedValue(true);
      mockSessionService.getUserData.mockResolvedValue({
        userId: TEST_USER_ID,
        currentCollection: collectionId
      });
      
      // Execute
      const result = await workflow.deleteCollection(TEST_USER_ID, collectionId);
      
      // Verify
      expect(mockCollectionDB.deleteCollection).toHaveBeenCalledWith(collectionId);
      expect(mockSessionService.updateUserData).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
  
  describe('createConfigHash', () => {
    it('should create a consistent hash for collection configuration', () => {
      // Setup
      const collection = {
        totalSupply: 100,
        config: {
          masterPrompt: 'Test master prompt',
          traitTypes: [
            {
              traits: [
                { prompt: 'Trait 1' },
                { prompt: 'Trait 2' }
              ]
            },
            {
              traits: [
                { prompt: 'Trait 3' },
                { prompt: 'Trait 4' }
              ]
            }
          ]
        }
      };
      
      // Execute
      const hash = workflow.createConfigHash(collection);
      
      // Verify
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hash is 64 hex chars
      
      // Should be consistent
      const hash2 = workflow.createConfigHash(collection);
      expect(hash).toEqual(hash2);
    });
  });
}); 