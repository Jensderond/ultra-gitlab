// ==UserScript==
// @name         GitLab - Open in Ultra GL
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Adds an "Open in Ultra GL" button on GitLab merge request pages (Kanagawa Wave theme)
// @author       Ultra GitLab
// @match        https://gitlab.com/*/merge_requests/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = 'ultra-gl-btn';

    // Ultra GitLab app icon (32x32 base64 PNG)
    const ICON_BASE64 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAK50lEQVR42rVXeXAb1Rn/7anVLcuSLFu+YxscEyfkBOewyTETJuFqCSlModCGKdB26EFLS6eTSQudlikzndLSKcMUJoUCSUob0kAuYifEJCQ4iZ3YOZz4kCzLp2TZOne122/tODEk/NX2aXb09u3u+37f9fu+x+MGQ1VVZseOHWy728004L8bTXTVDA9r999/v8qyrPbF5/wXF7Zt28bRi1ma6he24H839L0feOCB7JcC2Lx5M6u/oGma4f3GfQvjCbWY5zlJMAgagYIoihBYAYLIgaP3CenVb7Oqimw2C1m/ZJrTT5FlJqMoaaMgBNbXrzjBMGxKl7FlyxZ1+jtmpnD9wS//8Kevj2W03yY1rkABC4bjwLIMdAACy4HnaY1+hBIMQ+v0TxO6pz1prmkMFJWEq/q9LkCDgdFg4bSQTcAzP/n243+fCYKZaZpnX/r9Q2GZe6s/moCi78AwtB00XVF945SsQCENRYGAcCytaWCv6KESAJ5hr4DRrmlGW+gYDYLAFdiNsDHpB1/88Y/emZbJXAGhaaoqPP27P14OJrJFtKCILMvrmnCcLpg2pHlRrhklLitCkTh6RuPkQI7MroIjobwkQk7LEMlCCq2pOlBCTuIpqCcBKipYPl+C/+Vnn55F7lB02ZyOZPv27VrFkgULQhPpZybSiiqJDCdnM7DZjFBI8yqPET/fcCs21t8MV44JBhI2x2fHaEpF6thB8KIB46NjuMXBYO261Sh22RBLZwh4muKE3ERKcBzHqtBUq8XoCPq7d+/avj24gWTzeqpNhaOUL5gkiPGExpJ5a8uKUenzwS0ksKDSia7BJLra+rCvuQPFpXmwWa3IjQ6gUvHDoSXhDwQwq+67MFvNsAkMirwuHDrZge7QEAHgSDTFBxmENxqhikavLnJ2eztzNQvInyaDKEAi/0omAzL0toeLoaG2H/tbB/HXtw5hNDSMYN8I6utrsGJdHQb8IViRRFRJITtvMfadvYjlTh8yZJFL/n5kMjKMpJRKLtEdzWc1SEYRvMEgTQptaADfcCXXDSLPOBwSsqwVkZgMN59Aw8IqBAcm8IOfvoFIJIakTG4xG7H3o1Y48nLhiAWQFATsu8QjW5CFJ/oZIpUVsFTcRK5TIRPv8Lr2ei6oeixkYTDyEHUtp3mgadoCSUUbC8fQ0zeIRaVOPHVnLcZjCrwuM75533w0HzsDW64Tew5dQH6pF7LZDGloEE/cV44nV34VLR+3wtLrx55zp1C9+HZ455sQHIlgLJGAz5mDtCxjnOZWqwUeh22SEXXlr1rAyFOoTiRwe6ENT6yfi9ZQwm09o6ivsqFOXU1KCuQce88tfvirPQhcuhUCsc+PY/06CAWoAsbHX14OW6Hs/FtLLcOILtiJS5nNBw+0oEld90BlrhgcCQ0SUwCx0Odqi2T6WrXZCyvKsBwLHs9FceSKlp7wtix9wwEQcLZU11QU0ksbZiL0uIcHPn4KGLRVhgcFmIJB2qt3Xi324SyD5txQAwjcPYyLjQfxapND6KoqhipRJLYMINELAPRJMJGad9ACh3viiBNa9ODnY6B84EoLgYmMBQYwd5dn8E/GMNYLIE3th4ES2bMurzYf5mBT0/RoTZw8XHk1N6Co/wsHP7gMKwVJVj/9KOwWI1ITsTI6lkwSQUe4oxMNIbFJbk41jmCbTtPoj8QmaqUTU3XYsBFiqlEFevuWYz5i6N47ZXd+ORkABwv4EzrfsgKi/m3rcPbHZ+gb2QU3WYWq2aHkUm5sKbMiQGnE8PdvWCJ7/QI0+tIirXD5rRhw2JKe8GAX//5IAFPY9WiiutdEM9kEWdEHN57Ah4roSYaTaaz0FJpCFYHtmxajo0bl+LYibtQnUzhvV+8gKNEyQcufYJSD5GP2QSBHJ6igDNRxJno+wF/LzjFhc6QHZt/8w4ks4DvfKseJvM0DTRcAyBQvtZV5yHcZsJLrzSifHYhysosyM2xYcsTDfDkO3Cg+RLlsYBZxbloTbLYGUiiZF4NWvv6UB0YRMnSuRCJgsciUcjJKAQ5TuXZja27O2ivPHzt4RUYT2Ux3DNypVlpugagpjQHN+UK8D2+EstW1sKdY0YecUCrfwzDjIBPP+5CZ3AYSjSMBOXzLavrkDx4AqUlHhQurYGL6oaByWA0PIQoFSrJ4YJYUoYRIrVCr4qyOdV4t6kdYUrtNfPKrrZLVwGkMirlKVUxCrhLg+M42RvBxOg4fB4rnG4nSovc2NfUAjsbg93pgN2eD8fGO6FRiTbTLgPBQQrcOKzeInjKSiETy586fglzy224Y/l87Nx7GtGOHlSV5OuJeX0MRMhsLJeLXf8+iW172tDfF8GC22YjG48jQXEQTTpQUu7DoX0tqKoUwamjFKA8pW8Gx4NxDERVuAvyERtJ4sypNqhKBvesnQPJ48LWnZ8hOxxGkrKiLzSGSnLHdQCGR2PaB639OHCiB23t/TCbRXS0deGf53rw2MMrUXEzA69JQFFhHs5dimL1slJEI6NobupDghXhK3RCyMSRm5uL+rvnYZRY9UJoHCPtI1hYWwD7/HKME9ULVJDyPZap5rRBrwVNU0zQGxxjBgNhPPngUnScCaBnYAwDQ+NUxUTseO8Y7l47H6vXL8QanwcIh7G78QI8Xge+t2n1ZFfEU5UTqYoOKgLClGpyQsXqVeUI8yImwuMwE0XLLjccpHIqOHyFimdkAcvIWmdfFGG5BH97+RH8Y/9ZJBMZxGMpLJrrw03VRfCH0+ilclxa4sayZZUYpvmnZ/phMvCIUBsnkYU8HjvmVuXBn+aw7+BZ9A9EwSgyfHl2dJ4fhMOdg/Vr56pXmOgagJFoMm6iIvnC87so6KxwOM1Yu6oaCyli33zzCC6H4liwuAxd7X1474OzWFTlIZpNU98A5HlzULukAhmKh2g0iQ+bL6Pz8hAVsBzcWuPDzRXeSYa8714eIao1fv9I/GoMdHR0TPpDNHP94fOjOHMuyNiHLcTjCjo6QyjIsaD9XBCcZEBgQsYKakZOvPg+PhqKkiVyMRZN4WRLLySLEZJELTujoKLUhe8/UgczKdJycQiv/asFoWCE3GBilswpQrXN0q/L1GVfa0o1VVhz72Ndx0+PFBrtkmK2iLySoOgPx5FDJKSSdia7CcVFLsyuyMPxk91IkmltNhPcbgdMRFA5DuMky6WoOT3vD6O1pRsTlNLUnegtPPWqWX5ZXXHfnm2vltO9rMvWXaBt2LCBGltW/sbjTz03qySztbM3ymf1kwbBYnhRi4aTkyjj6Tj6acPmI53w5dvhIMqWUzK6A8NUKzQMEmlFiZ5TBJanhsBoEDHZMgsMo2oaX13pQpnX9pwuXJdJzXCWmXEsYkGHha88tOnRHn/4N+MJJS9DBUibPIYQVL27pVovSjz0pjWdUDBpP3KgSpVPpdOQfizQDzD6B/qZQSc1nXREas1yLPzArFL3z9598y9vTMv63MloJojGxtelV19vrB2LygWUtjZRpNMBx2mSJFFLLugtNvUMAmiZJGaRIitMXZmpYxn1AfrJUiazEPCY22IOPr9p6emyOx5LzRR+PQAa06bB/2HcaG/mS95l6GV2aGhoxvOGG04/dw6/8Q1xg0cjweqUwz4//gMcWgKI5o1MUgAAAABJRU5ErkJggg==';

    // Kanagawa Wave theme palette
    const KW = {
        bgPrimary: '#16161d',
        bgSecondary: '#1f1f28',
        bgTertiary: '#2a2a37',
        bgHover: '#363646',
        textPrimary: '#dcd7ba',
        textSecondary: '#c8c093',
        accent: '#7e9cd8',
        accentHover: '#7fb4ca',
        border: '#363646',
        focusRing: 'rgba(126, 156, 216, 0.4)',
        waveGlow: 'rgba(126, 156, 216, 0.15)',
    };

    function buildUltraUrl() {
        const url = window.location.origin + window.location.pathname;
        return 'ultra-gitlab://open?url=' + encodeURIComponent(url);
    }

    function createButton() {
        const btn = document.createElement('a');
        btn.id = BUTTON_ID;
        btn.href = buildUltraUrl();
        btn.title = 'Open this MR in Ultra GL';
        btn.setAttribute('aria-label', 'Open in Ultra GL');
        btn.className = 'gl-button btn btn-md btn-default gl-self-start has-tooltip';
        btn.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: ${KW.bgSecondary};
            color: ${KW.textPrimary} !important;
            border: 1px solid ${KW.border};
            border-radius: 8px;
            white-space: nowrap;
            text-decoration: none !important;
            flex-shrink: 0;
            font-family: 'Noto Sans JP', -apple-system, sans-serif;
            font-size: 13px;
            font-weight: 500;
            letter-spacing: 0.02em;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        `;

        const icon = document.createElement('img');
        icon.src = ICON_BASE64;
        icon.width = 18;
        icon.height = 18;
        icon.style.cssText = 'flex-shrink: 0; border-radius: 3px;';
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'gl-button-text';
        text.textContent = 'Open in Ultra GL';

        btn.appendChild(icon);
        btn.appendChild(text);

        btn.addEventListener('mouseenter', () => {
            btn.style.background = KW.bgTertiary;
            btn.style.borderColor = KW.accent;
            btn.style.color = KW.accentHover + ' !important';
            btn.style.boxShadow = '0 2px 8px ' + KW.waveGlow;
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = KW.bgSecondary;
            btn.style.borderColor = KW.border;
            btn.style.color = KW.textPrimary + ' !important';
            btn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
        });
        btn.addEventListener('focus', () => {
            btn.style.borderColor = KW.accent;
            btn.style.boxShadow = '0 0 0 3px ' + KW.focusRing;
        });
        btn.addEventListener('blur', () => {
            btn.style.borderColor = KW.border;
            btn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
        });

        return btn;
    }

    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const actionsContainer = document.querySelector('.js-issuable-actions');
        if (!actionsContainer) return;

        actionsContainer.appendChild(createButton());
    }

    function init() {
        injectButton();

        const observer = new MutationObserver(() => {
            injectButton();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
