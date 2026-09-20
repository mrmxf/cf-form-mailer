/**
 * Field-array-driven validation, shared by every form.
 *
 * THE PROPERTY WORTH PROTECTING: render.js and validate() below read the SAME
 * fields array, so it remains structurally impossible to add a question to a
 * page and forget to validate it — the commonest way a form like this springs a
 * leak. Extracting this into lib/ did not weaken that; it is now enforced for
 * every form at once instead of one form at a time.
 */

/**
 * Deliberately permissive. This is a sanity check that the address has a shape
 * mail can be delivered to, not an attempt to implement RFC 5322 — which cannot
 * be done with a regex, and which rejects real addresses when people try.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {FormData|URLSearchParams} data
 * @param {Array<object>} fields  The form's FIELDS array.
 * @returns {{ok: boolean, values: Record<string,string>, errors: Record<string,string>}}
 *          `values` is always populated with whatever was submitted (cleaned),
 *          so the page can be re-rendered without the visitor losing their typing.
 */
export function validate(data, fields) {
  const values = {};
  const errors = {};

  for (const field of fields) {
    const raw = data.get(field.name);
    let value = typeof raw === "string" ? raw.trim() : "";

    if (field.transform === "upper") value = value.toUpperCase();

    // Collapse runs of whitespace, including the newlines someone gets by
    // pasting from a document. `multiline` fields keep their line breaks — a
    // contact message is unreadable as one long line.
    value = field.type === "textarea"
      ? value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ")
      : value.replace(/\s+/g, " ");

    values[field.name] = value;

    if (!value) {
      if (field.required) errors[field.name] = `${field.label} is required.`;
      continue;
    }

    if (field.maxLength && value.length > field.maxLength) {
      errors[field.name] = `${field.label} must be ${field.maxLength} characters or fewer.`;
      continue;
    }

    if (field.type === "email" && !EMAIL_RE.test(value)) {
      errors[field.name] = "That does not look like an email address.";
      continue;
    }

    if (field.options && !field.options.some((o) => o.value === value)) {
      errors[field.name] = `Please choose one of the options for "${field.label}".`;
    }
  }

  return { ok: Object.keys(errors).length === 0, values, errors };
}
