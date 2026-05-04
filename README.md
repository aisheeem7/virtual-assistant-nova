# **NOVA — AI Chatbot**

A conversational AI assistant with voice input, speech output, live web search, and persistent chat history. Built with **React** and the **Google Gemini API**.

---

### **Features**

*   **AI Responses:** Powered by Google Gemini 2.5 Flash with live Google Search grounding for real-time accuracy.
*   **Voice Input:** Integration with the browser's Web Speech API—speak instead of type.
*   **Text-to-Speech Output:** Utilizes the SpeechSynthesis API so NOVA reads every response aloud.
*   **Multi-turn Memory:** Full conversation context is sent with every message for seamless flow.
*   **Persistent Chat History:** All sessions are saved to `localStorage` and accessible via the sidebar.
*   **Smart Retry Logic:** Automatically retries on rate limit errors to ensure a smooth user experience.
*   **Always Date-Aware:** Current date and time are injected into every request for up-to-date answers.
*   **Dark Mode UI:** Sleek interface with color-coded message bubbles and a collapsible sidebar.

---

### **Tech Stack**

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 18, Vite |
| **AI Model** | Google Gemini 2.5 Flash via @google/genai SDK |
| **Web Search** | Gemini Google Search grounding tool |
| **Voice Input** | Web Speech API — SpeechRecognition |
| **Voice Output** | Web Speech API — SpeechSynthesis |
| **Storage** | localStorage |

---

### **Prerequisites**

*   Node.js v18 or higher.
*   A free Gemini API key from [aistudio.google.com](https://aistudio.google.com).

---

### **Installation**

1. **Clone and install**
```bash
git clone [https://github.com/your-username/nova-chatbot.git](https://github.com/your-username/nova-chatbot.git)
cd nova-chatbot
npm install
``` 

### **Add Your API Key**

Create a .env file in the root folder and add your API key:
```bash
VITE_GEMINI_API_KEY=your_gemini_api_key_here
``` 

### **Start the dev server**
```bash
npm run dev
```

---

### **Open http://localhost:5173 in your browser.**
