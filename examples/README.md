# examples — embedding the form in a site

Copy the file for your generator into your site and edit nothing but the paths.
All three do the same thing:

1. an `<iframe>` pointing at the form with `?embed=1`, which renders it without its
   own header and footer
2. a script that sizes the frame to its contents, so there is no scrollbar inside the
   page, and re-sizes after a validation error or the thank-you page
3. a visible link to the form's own page, which is what a visitor gets if the frame
   cannot load

| file | for |
|---|---|
| `html/form-frame.html` | any static site — paste it straight into the page |
| `hugo/form-frame.html` | Hugo — `layouts/_shortcodes/form-frame.html` |
| `jekyll/form-frame.html` | Jekyll — `_includes/form-frame.html` |
| `css/form-frame.css` | all three — paste into your stylesheet |

The sizing only works when the form is **same-origin** with the page: route the Worker
on your own domain (`example.org/forms/contact*`), not on `*.workers.dev`. Anywhere it
is cross-origin, or not deployed — `hugo server`, `jekyll serve`, a preview host — the
script fails quietly and the CSS `min-height` stands. The page still works; the frame
is just taller than it needs to be.
