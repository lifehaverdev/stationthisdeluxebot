/**
 * Test Users Fixture
 * 
 * Mock user data for testing
 */

const testUsers = [
  {
    id: 'user-001',
    telegramId: 123456789,
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    isAdmin: false,
    createdAt: new Date('2023-01-01').toISOString(),
    lastActive: new Date('2023-04-01').toISOString(),
    settings: {
      notifications: true,
      theme: 'light'
    }
  },
  {
    id: 'user-002',
    telegramId: 987654321,
    username: 'adminuser',
    firstName: 'Admin',
    lastName: 'User',
    isAdmin: true,
    createdAt: new Date('2022-12-15').toISOString(),
    lastActive: new Date('2023-04-02').toISOString(),
    settings: {
      notifications: true,
      theme: 'dark'
    }
  }
];

module.exports = {
  testUsers
}; 