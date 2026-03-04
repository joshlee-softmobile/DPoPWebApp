import { LitElement, html, css } from 'lit';

export class LoaderOverlay extends LitElement {
  static properties = {
    show: { type: Boolean },
    message: { type: String }
  };

  static styles = css`
    :host {
      display: contents; /* Ensures the component doesn't interfere with layout */
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(6px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .overlay.active {
      opacity: 1;
      pointer-events: auto;
    }

    sl-spinner {
      font-size: 3.5rem;
      --track-width: 6px;
    }

    p {
      color: white;
      margin-top: 1.5rem;
      font-family: var(--sl-font-sans);
      font-weight: var(--sl-font-weight-medium);
      letter-spacing: 0.5px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
  `;

  render() {
    return html`
      <div class="overlay ${this.show ? 'active' : ''}">
        <sl-spinner></sl-spinner>
        <p>${this.message || 'Processing...'}</p>
      </div>
    `;
  }
}