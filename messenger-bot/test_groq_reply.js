const fs = require('fs');
const axios = require('axios');

const PAGES_FILE = "./pages.json";
const pages = JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8'));
const pageConfig = pages["888451557694404"];
const script = pageConfig.script;
const apiKey = pageConfig.apiKey;
const model = pageConfig.model;
const temperature = pageConfig.temperature;

async function testGroq() {
  console.log("Calling Groq with model:", model);
  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: model,
        messages: [
          {
            role: "system",
            content: script
          },
          {
            role: "user",
            content: "Alo"
          }
        ],
        max_tokens: 500,
        temperature: temperature
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    console.log("Groq Response:");
    console.log(response.data.choices[0].message.content);
  } catch (err) {
    console.error("Error calling Groq:", err.response ? err.response.data : err.message);
  }
}

testGroq();
