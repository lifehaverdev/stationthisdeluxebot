async function createClient() {
    const { default: OpenAI } = await import('openai');
    return new OpenAI({
        apiKey: '',
        baseURL: 'https://www.miladystation2.net/api/v1'
    });
}

async function testGeneration() {
    try {
        const openai = await createClient();
        console.log('Starting image generation...');
        const response = await openai.images.generate({
            prompt: "test prompt for api generation through openai client",
            wait: true
        });
        
        console.log('Generation successful!');
        console.log('Response:', JSON.stringify(response, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

if (require.main === module) {
    testGeneration();
}

module.exports = { testGeneration };
