# Medha: The "Local Brain" Architecture 🧬🧠

Medha is a privacy-first personal intelligence system that lives entirely on your mobile device. Unlike cloud-based AI, Medha's knowledge is stored in your own "Local Brain," an optimized combination of vector search and high-performance inference.

### The "Local Brain" Workflow
1. **The Encoder (llama.rn)**: When you save a note, Medha passes that text into a small Embedding Model (all-MiniLM-L6-v2) via the `llama.rn` engine. It generates a 384-dimension vector.
2. **The Memory (Nitro SQLite + sqlite-vec)**: This vector is stored in a specialized `vec0` virtual table. We use a **Smart Hybrid Ranker** that combines semantic "closeness" with a strong +8.0 weight boost for exact keyword matches.
3. **The Retrieval**: When you ask a question, Medha vectorizes your query, searches your memories, and pulls the most relevant notes to the top of the context window.
4. **The Assistant (Reasoning Engine V2.1)**: Your query, the retrieved notes, and your **Recent Chat History** are fed into a GGUF model (Mistral, Phi, or Gemma). The assistant uses the **Strikeout Method** to audit the facts and provide a surgical, hallucination-free answer.

### Why this architecture wins:
* **Total Privacy**: 100% offline. Not a single byte of your data leaves the phone.
* **Instant Speed**: Using JSI and C++ means searching thousands of notes happens in milliseconds.
* **Algorithmic Logic**: The Strikeout reasoning solves common "Working Memory" failures in mobile LLMs, ensuring Medha stays honest and precise.

---
*Medha Technical Documentation — Intelligence V2.1 Update*
