export class PromptOverlay {
  private overlay: HTMLDivElement;
  private input: HTMLInputElement;
  private caret: HTMLSpanElement;
  onSubmit?: (text: string) => void;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'prompt-overlay';

    const promptContainer = document.createElement('div');
    promptContainer.id = 'prompt-container';

    this.caret = document.createElement('span');
    this.caret.id = 'prompt-caret';
    this.caret.textContent = '>_';

    this.input = document.createElement('input');
    this.input.id = 'prompt-input';
    this.input.type = 'text';
    this.input.maxLength = 40;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;

    promptContainer.appendChild(this.caret);
    promptContainer.appendChild(this.input);
    this.overlay.appendChild(promptContainer);
    container.appendChild(this.overlay);

    // Focus input after a moment
    setTimeout(() => this.input.focus(), 100);

    // Also focus on any click on the overlay
    this.overlay.addEventListener('click', () => this.input.focus());

    // Handle submit
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text.length > 0) {
          this.onSubmit?.(text);
          this.fadeOut();
        }
      }
    });
  }

  private fadeOut(): void {
    this.overlay.classList.add('fading');
    setTimeout(() => {
      this.overlay.remove();
    }, 1500);
  }

  isActive(): boolean {
    return document.contains(this.overlay) && !this.overlay.classList.contains('fading');
  }
}
