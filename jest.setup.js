// Mock Telegram Bot API to prevent connection attempts during testing
jest.mock('node-telegram-bot-api', () => {
  class MockTelegramBot {
    constructor() {
      this.on = jest.fn();
      this.onText = jest.fn();
      this.sendMessage = jest.fn().mockResolvedValue({});
      this.sendPhoto = jest.fn().mockResolvedValue({});
      this.editMessageText = jest.fn().mockResolvedValue({});
      this.editMessageReplyMarkup = jest.fn().mockResolvedValue({});
      this.deleteMessage = jest.fn().mockResolvedValue(true);
      this.getMe = jest.fn().mockResolvedValue({ username: 'test_bot' });
      this.getChatMember = jest.fn().mockResolvedValue({ status: 'member' });
      this.kickChatMember = jest.fn().mockResolvedValue(true);
      this.setChatStickerSet = jest.fn().mockResolvedValue(true);
      this.setChatDescription = jest.fn().mockResolvedValue(true);
      this.setChatTitle = jest.fn().mockResolvedValue(true);
      this.setChatPhoto = jest.fn().mockResolvedValue(true);
      this.getChat = jest.fn().mockResolvedValue({});
    }
  }
  return MockTelegramBot;
});

// Mock any other global dependencies that might be causing issues

// Set up any other global test setup if needed
process.env.NODE_ENV = 'test'; 