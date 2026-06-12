# Spoil 🚀
### An Autonomous AI Software Engineer & Desktop IDE

**Spoil** is a custom, low-maintenance AI coding environment built on Electron. It bridges a local UI with advanced LLMs to create an autonomous coding agent capable of modifying, building, and executing software projects directly on your local file system.

---

## 🛠️ Tech Stack & Architecture

* **Desktop Framework:** Electron.js (Chromium Frontend + Node.js Backend)
* **Code Editor Core:** Monaco Editor Engine (Virtualized Text Rendering)
* **Communication Protocols:** Server-Sent Events (SSE) for real-time response streaming
* **AI Connectivity:** OpenAI-Compatible API integration supporting Local Ollama instances, Groq Systems, and Google Gemini.

---

## 🧠 Core Features & Agentic Logic

### 1. The Autonomous Agent Loop
Spoil operates on a continuous feedback loop. When given a task, it doesn't just chat—it *acts*.
* **System Prompting:** Enforces strict Chain of Thought (CoT), demanding structural reasoning before executing tool blocks.
* **Structured Tools:** The agent utilizes custom XML parsing tags (`<create_file>`, `<read_file>`) to interact with the host operating system.

### 2. Live Stream Processing
Using `TextDecoder` and asynchronous stream readers, Spoil decodes incoming chunk packets on the fly, rendering markdown and code dynamically without freezing the application interface.

### 3. Smart Regex Code Extraction
Includes highly resilient Regular Expression parsers to safely extract raw executable code out of conversational markdown blocks, preventing compilation errors during automated file generation.

---

## 🚀 Getting Started

1. Clone the repository:
   ```bash
   git clone [https://github.com/YOUR_USERNAME/Spoil.git](https://github.com/YOUR_USERNAME/Spoil.git)


Install dependencies:

npm install


Run the application:

npm start
