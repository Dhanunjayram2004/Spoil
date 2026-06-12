// api.js
async function queryOllama(modelName, systemPrompt, userPrompt, requireJson = false) {
  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false, 
    options: { temperature: 0.2, num_ctx: 4096 } // Lowered context slightly for speed
  };

  // Only add the JSON format constraint if the model supports it well
  // Sometimes forcing JSON makes 4B models hang. We'll handle parsing manually.
  if (requireJson) {
      payload.format = "json";
  }

  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        // ⚡ BETTER ERROR HANDLING: Get the exact reason from Ollama
        const errorData = await response.text();
        throw new Error(`Ollama Error ${response.status}: ${errorData}`);
    }
    
    const data = await response.json();
    return data.message.content;
  } catch (error) {
    console.error(`Agent ${modelName} crashed:`, error);
    // Return a clear error string so the pipeline doesn't freeze invisibly
    return `ERROR_FETCHING_MODEL_${modelName}`; 
  }
}
module.exports = { queryOllama };