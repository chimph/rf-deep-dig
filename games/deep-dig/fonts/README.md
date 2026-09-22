# Silkscreen font packaging

`Silkscreen-Regular.ttf` and its SIL Open Font License are the original bundled font.

- `silkscreen.css` embeds that TTF as a data URL for the existing offline runner.
- `silkscreen-web.css` loads `Silkscreen-Regular.woff2` as a same-origin SDK asset for the sandboxed submission. The standard sandbox permits same-origin fonts but blocks data-URL fonts.

The WOFF2 was converted with fontTools 4.65.0 / Brotli 1.2.0. All glyph outlines and horizontal metrics were compared with the original TTF and are unchanged. These conversion tools are not runtime or build dependencies; the converted file is included in source.

To regenerate with fontTools and Brotli installed:

```python
from fontTools.ttLib import TTFont
font = TTFont('Silkscreen-Regular.ttf')
font.flavor = 'woff2'
font.save('Silkscreen-Regular.woff2')
```
