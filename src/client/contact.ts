import { byId, setMessage } from "./dom.js";

const RECIPIENT = "dilian.jaars@gmail.com";
const form = byId<HTMLFormElement>("contactForm");
const message = byId("formMessage");

interface Draft {
    subject: string;
    body: string;
}

function readForm(): Draft {
    const data = new FormData(form);
    const field = (name: string): string => String(data.get(name) ?? "").trim();
    return {
        subject: field("subject"),
        body: `${field("message")}\n\nFrom: ${field("name")} (${field("email")})`,
    };
}

function formIsValid(): boolean {
    setMessage(message);
    if (form.checkValidity()) return true;
    setMessage(message, "Fill in every field, using a valid email address.");
    form.querySelector<HTMLElement>(":invalid")?.focus();
    return false;
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!formIsValid()) return;
    const { subject, body } = readForm();
    window.location.href =
        `mailto:${RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setMessage(message, "Your email app should open with the message ready to send.", true);
});

byId("gmailButton").addEventListener("click", () => {
    if (!formIsValid()) return;
    const { subject, body } = readForm();
    const url =
        "https://mail.google.com/mail/?view=cm&fs=1" +
        `&to=${encodeURIComponent(RECIPIENT)}` +
        `&su=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    setMessage(message, "Gmail opened in a new tab with the message ready to send.", true);
});
