/**
 * Test script for OpenAI model card generation
 * Usage: ./run-with-env.sh node scripts/test-openai-modelcard.js
 */

const OpenAIService = require('../src/core/services/openai/openaiService');

async function testModelCard() {
  const openai = new OpenAIService({ logger: console });
  
  if (!openai.openai) {
    console.error('OpenAI not initialized - check OPENAI_API env var');
    process.exit(1);
  }
  
  console.log('OpenAI initialized\n');
  
  // Simulate what ModelCardGenerator does
  const modelName = 'ru_neo';
  const triggerWord = 'ru_neo';
  
  // Sample caption (truncated to 300 chars like we do now)
  const sampleCaption = `A stylized digital portrait featuring bold outlines and vibrant flat colors, reminiscent of pop art and comic book aesthetics. The subject has exaggerated features with strong contrast between light and shadow areas.`.slice(0, 300);
  
  const prompt = `Based on this training caption, write a 2-sentence description for a HuggingFace LoRA model card. Be specific about the visual style.

Model: ${modelName}
Trigger: ${triggerWord}
Caption: ${sampleCaption}

Write ONLY the description, no headers.`;

  console.log('=== REQUEST ===');
  console.log('Model: gpt-4o-mini');
  console.log('Prompt length:', prompt.length, 'chars');
  console.log('Prompt:', prompt);
  console.log('\n=== CALLING OPENAI ===\n');
  
  try {
    const startTime = Date.now();
    const result = await openai.executeChatCompletion({
      prompt,
      instructions: 'You are writing HuggingFace model card descriptions. Be concise and specific about what the LoRA does.',
      model: 'gpt-4o-mini',
      temperature: 0.7,
    });
    const elapsed = Date.now() - startTime;
    
    console.log('✅ Success!');
    console.log('Time:', elapsed, 'ms');
    console.log('Tokens:', result.usage);
    console.log('\n=== GENERATED DESCRIPTION ===');
    console.log(result.content);
    
  } catch (err) {
    console.log('❌ Failed!');
    console.log('Error:', err.message);
    if (err.original) {
      console.log('Original error:', err.original.message);
      console.log('Status:', err.original.status);
    }
  }
}

testModelCard();
