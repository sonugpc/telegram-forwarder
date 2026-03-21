"use strict";
const fs = require("fs");
const path = require("path");

/**
 * Lightweight JSON file-based key-value store.
 * Designed to be swappable with a SQL adapter later — consumers should
 * only call read() / write() and never depend on the file format.
 */
class JsonStore {
  constructor(filePath) {
    this._path = path.resolve(filePath);
    const dir = path.dirname(this._path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this._path)) fs.writeFileSync(this._path, "{}", "utf8");
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this._path, "utf8"));
    } catch {
      return {};
    }
  }

  write(data) {
    fs.writeFileSync(this._path, JSON.stringify(data, null, 2), "utf8");
  }
}

module.exports = JsonStore;
