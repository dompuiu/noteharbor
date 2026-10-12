class BaseScraper {
  constructor(note) {
    this.note = note;
  }

  getWaitForSelector() {
    return null;
  }

  parse() {
    throw new Error('parse() must be implemented by subclasses');
  }
}

export { BaseScraper };
