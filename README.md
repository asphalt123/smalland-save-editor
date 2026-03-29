# Smalland: Survive the Wilds — Save Editor (Web)

> [!IMPORTANT]
> **Privacy First**: This editor is 100% offline. No data is stored, tracked, or uploaded to any server. All save file processing occurs locally within your web browser.

A modern, offline-first web-based save editor for **Smalland: Survive the Wilds**. Designed to handle multi-chunk Unreal Engine 4 save files, it allows you to easily modify player stats, inventory items, and your tamed creatures without ever uploading your sensitive save data.

## 🚀 Live Demo
[**[CLICK ME]**](https://asphalt123.github.io/smalland-save-editor/)

## ✨ Features
- **Player Stats**: Modify Level, Experience, and Combat Attributes (Strength, Endurance, etc.).
- **Inventory Management**: Edit item quantities and edit **Durability** for Weapons/Tools natively.
- **Item Actions**: Instantly **Copy/Clone** or **Remove** items with safe ID generation.
- **Creature Stable**: Full support for Tamed Creatures, including renaming, leveling, and deep-cloning (recursive ID re-mapping).
- **Multi-Chunk Support**: Automatically handles large saves with multi-part UE4 compression.
- **Privacy Focused**: No data is uploaded to any server. All processing happens locally in your browser using WebAssembly/pako.

## 🛠️ Deployment to GitHub Pages
Since this is a static project, you can host it for free on GitHub Pages:

1. **Create a Repo**: Create a new repository on GitHub named `smalland-save-editor`.
2. **Push your code**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Smalland Save Editor"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/smalland-save-editor.git
   git push -u origin main
   ```
3. **Enable Pages**: Go to your repository **Settings** -> **Pages**.
4. **Select Source**: Under "Build and deployment", set the source to **Deploy from a branch** and select `main` / `(root)`.
5. **Done**: Your editor will be live at `https://YOUR_USERNAME.github.io/smalland-save-editor/`.

## 📦 Tech Stack
- **HTML5 / Vanilla CSS**: Modern Glassmorphism UI.
- **JavaScript (ES6+)**: Custom binary parser for UE4 formats.
- **Pako**: Zlib decompression library for handling `.plr` chunks.

## ⚖️ License
MIT License.
