import { LitElement, html, css } from 'lit';

const PREVIEW_LIMIT = 5;

export class UserPostsCard extends LitElement {
    static styles = css`
        :host {
            display: block;
            height: 100%;
        }

        sl-card {
            width: 100%;
            height: 100%;
            --width: 100%;
            border: none;
            max-width: 100%;
            overflow: hidden;
        }

        sl-card::part(base) {
            height: 100%;
            display: flex;
            flex-direction: column;
            border: 1px solid var(--sl-color-neutral-300);
            box-shadow: var(--sl-shadow-medium);
            overflow: visible;
            background-color: var(--sl-color-neutral-0);
        }

        sl-card::part(body) {
            flex: 1 1 auto;
            padding: 0;
            overflow: hidden;
        }

        /* ── Header ── */
        .header-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: bold;
            font-size: 0.8rem;
            color: var(--sl-color-neutral-700);
        }

        .header-icon {
            color: var(--sl-color-primary-500);
            font-size: 1.2rem;
        }

        .header-count {
            margin-left: auto;
            font-size: 0.7rem;
            font-weight: normal;
            color: var(--sl-color-neutral-500);
            background: var(--sl-color-neutral-100);
            border-radius: var(--sl-border-radius-pill);
            padding: 2px 8px;
        }

        /* ── Post List ── */
        .post-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .post-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: var(--sl-spacing-small) var(--sl-spacing-medium);
            border-bottom: 1px solid var(--sl-color-neutral-100);
            cursor: pointer;
            transition: background 0.15s ease;
            position: relative;
        }

        .post-item:last-child {
            border-bottom: none;
        }

        .post-item:hover {
            background: var(--sl-color-primary-50);
        }

        .post-item:hover .post-title {
            color: var(--sl-color-primary-600);
        }

        .post-index {
            flex-shrink: 0;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: var(--sl-color-primary-100);
            color: var(--sl-color-primary-700);
            font-size: 0.65rem;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 1px;
        }

        .post-content {
            flex: 1;
            min-width: 0;
        }

        .post-title {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--sl-color-neutral-800);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: color 0.15s ease;
            line-height: 1.35;
        }

        .post-meta {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 4px;
        }

        .post-views {
            font-size: 0.65rem;
            color: var(--sl-color-neutral-500);
            display: flex;
            align-items: center;
            gap: 3px;
        }

        .reactions {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.65rem;
            color: var(--sl-color-neutral-500);
        }

        .like    { color: var(--sl-color-success-600); }
        .dislike { color: var(--sl-color-danger-500); }

        /* ── Tag chips ── */
        .tag-chip {
            font-size: 0.6rem;
            padding: 1px 6px;
            border-radius: var(--sl-border-radius-pill);
            background: var(--sl-color-neutral-100);
            color: var(--sl-color-neutral-600);
            border: 1px solid var(--sl-color-neutral-200);
            white-space: nowrap;
        }

        /* ── View More (sl-details) ── */
        .view-more-wrapper {
            border-top: 1px dashed var(--sl-color-neutral-200);
        }

        .view-more-wrapper sl-details {
            --border-color: transparent;
        }

        .view-more-wrapper sl-details::part(base) {
            border: none;
        }

        .view-more-wrapper sl-details::part(header) {
            padding: var(--sl-spacing-x-small) var(--sl-spacing-medium);
            font-size: 0.75rem;
            color: var(--sl-color-primary-600);
            font-weight: 600;
        }

        .view-more-wrapper sl-details::part(content) {
            padding: 0;
        }

        /* ── Empty State ── */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: var(--sl-spacing-2x-large) var(--sl-spacing-medium);
            gap: var(--sl-spacing-small);
            color: var(--sl-color-neutral-400);
        }

        .empty-icon {
            font-size: 2rem;
            color: var(--sl-color-neutral-300);
        }

        .empty-text {
            font-size: 0.8rem;
        }

        /* ── Dialog body ── */
        .dialog-body {
            font-size: 0.9rem;
            line-height: 1.65;
            color: var(--sl-color-neutral-700);
        }

        .dialog-meta {
            margin-top: var(--sl-spacing-medium);
            padding-top: var(--sl-spacing-small);
            border-top: 1px solid var(--sl-color-neutral-200);
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
        }

        .dialog-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .dialog-reactions {
            margin-left: auto;
            display: flex;
            gap: 12px;
            font-size: 0.8rem;
        }

        .dialog-views {
            font-size: 0.75rem;
            color: var(--sl-color-neutral-500);
            display: flex;
            align-items: center;
            gap: 4px;
        }
    `;

    static properties = {
        posts: { type: Array },
        _activePost: { type: Object, state: true },
    };

    constructor() {
        super();
        this.posts = [];
        this._activePost = null;
    }

    _openPost(post) {
        this._activePost = post;
        this.updateComplete.then(() => {
            this.shadowRoot.getElementById('postDialog')?.show();
        });
    }

    _closePost() {
        this.shadowRoot.getElementById('postDialog')?.hide();
        this._activePost = null;
    }

    _renderPostItem(post, index) {
        const tags = Array.isArray(post.tags) ? post.tags : [];
        return html`
            <li class="post-item" @click=${() => this._openPost(post)}>
                <span class="post-index">${index + 1}</span>
                <div class="post-content">
                    <div class="post-title" title="${post.title}">${post.title}</div>
                    <div class="post-meta">
                        <span class="post-views">
                            <sl-icon name="eye" style="font-size: 0.7rem;"></sl-icon>
                            ${(post.views ?? 0).toLocaleString()}
                        </span>
                        <span class="reactions">
                            <span class="like">▲ ${(post.reactions?.likes ?? 0).toLocaleString()}</span>
                            <span class="dislike">▼ ${(post.reactions?.dislikes ?? 0).toLocaleString()}</span>
                        </span>
                        ${tags.slice(0, 2).map(t => html`<span class="tag-chip">${t}</span>`)}
                    </div>
                </div>
                <sl-icon name="chevron-right" style="font-size: 0.75rem; color: var(--sl-color-neutral-400); margin-top: 4px; flex-shrink: 0;"></sl-icon>
            </li>
        `;
    }

    render() {
        const posts = this.posts ?? [];
        const preview = posts.slice(0, PREVIEW_LIMIT);
        const rest    = posts.slice(PREVIEW_LIMIT);
        const total   = posts.length;

        const p = this._activePost;

        return html`
            <sl-card>
                <!-- Header -->
                <div slot="header" class="header-title">
                    <sl-icon name="journal-text" class="header-icon"></sl-icon>
                    MY POSTS
                    <span class="header-count">${total} total</span>
                </div>

                <!-- Body -->
                ${total === 0 ? html`
                    <div class="empty-state">
                        <sl-icon name="journal-x" class="empty-icon"></sl-icon>
                        <span class="empty-text">No posts found</span>
                    </div>
                ` : html`
                    <!-- Top 5 -->
                    <ul class="post-list">
                        ${preview.map((post, i) => this._renderPostItem(post, i))}
                    </ul>

                    <!-- View More (only if there are additional posts) -->
                    ${rest.length > 0 ? html`
                        <div class="view-more-wrapper">
                            <sl-details summary="View ${rest.length} more post${rest.length > 1 ? 's' : ''}">
                                <ul class="post-list">
                                    ${rest.map((post, i) => this._renderPostItem(post, PREVIEW_LIMIT + i))}
                                </ul>
                            </sl-details>
                        </div>
                    ` : ''}
                `}
            </sl-card>

            <!-- Post Detail Dialog -->
            <sl-dialog id="postDialog" label="${p?.title ?? ''}">
                ${p ? html`
                    <div class="dialog-body">${p.body}</div>
                    <div class="dialog-meta">
                        <div class="dialog-tags">
                            ${(p.tags ?? []).map(t => html`<span class="tag-chip">${t}</span>`)}
                        </div>
                        <div class="dialog-reactions">
                            <span class="like">▲ ${(p.reactions?.likes ?? 0).toLocaleString()} likes</span>
                            <span class="dislike">▼ ${(p.reactions?.dislikes ?? 0).toLocaleString()} dislikes</span>
                        </div>
                    </div>
                    <div class="dialog-views" style="margin-top: 8px;">
                        <sl-icon name="eye" style="font-size: 0.75rem;"></sl-icon>
                        ${(p.views ?? 0).toLocaleString()} views &nbsp;·&nbsp; Post #${p.id}
                    </div>
                ` : ''}
                <sl-button slot="footer" variant="primary" @click=${() => this._closePost()}>Close</sl-button>
            </sl-dialog>
        `;
    }
}
