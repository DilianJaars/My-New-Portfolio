const RECIPIENT = "dilian.jaars@gmail.com";
const form = document.getElementById("contactForm");
const message = document.getElementById("formMessage");

function readForm() {
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    const email = String(data.get("email")).trim();
    const subject = String(data.get("subject")).trim();
    const body = `${String(data.get("message")).trim()}\n\nFrom: ${name} (${email})`;
    return { subject, body };
}

function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle("visible", Boolean(text));
    message.classList.toggle("success", success);
}

function formIsValid() {
    showMessage("");
    if (form.checkValidity()) return true;
    const firstBad = form.querySelector(":invalid");
    showMessage("Fill in every field, using a valid email address.");
    if (firstBad) firstBad.focus();
    return false;
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!formIsValid()) return;
    const { subject, body } = readForm();
    window.location.href =
        `mailto:${RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    showMessage("Your email app should open with the message ready to send.", true);
});

document.getElementById("gmailButton").addEventListener("click", () => {
    if (!formIsValid()) return;
    const { subject, body } = readForm();
    const url =
        "https://mail.google.com/mail/?view=cm&fs=1" +
        `&to=${encodeURIComponent(RECIPIENT)}` +
        `&su=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    showMessage("Gmail opened in a new tab with the message ready to send.", true);
});
