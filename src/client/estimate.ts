/**
 * "Estimate your project": builds a small calculator from the price lists on
 * the Services page (rows marked with data-calc), so the prices only live in
 * one place. Adds up a once-off range and a monthly amount, and sends the
 * choices to the contact page.
 */
import { byId, el } from "./dom.js";

interface Row {
    kind: "site" | "addon" | "host" | "maint";
    name: string;
    group: string;
    lo: number;
    hi: number;
    plus: boolean;
}

const section = byId("estimate");
const form = byId<HTMLFormElement>("calcForm");
const onceOut = byId("calcOnce");
const monthlyOut = byId("calcMonthly");
const summary = byId("calcSummary");
const sendLink = byId<HTMLAnchorElement>("calcSend");

const rows: Row[] = [...document.querySelectorAll<HTMLElement>("[data-calc]")].map((li) => ({
    kind: li.dataset.calc as Row["kind"],
    name: li.querySelector(".name")?.textContent?.trim() ?? "",
    group: li.closest("section")?.querySelector("h2")?.textContent?.trim() ?? "",
    lo: Number(li.dataset.lo),
    hi: Number(li.dataset.hi),
    plus: li.dataset.plus === "1",
}));

const money = (n: number): string => `R${n.toLocaleString("en-US")}`;

function range(lo: number, hi: number, plus: boolean): string {
    const end = money(hi) + (plus ? "+" : "");
    return lo === hi ? end : `${money(lo)} – ${end}`;
}

function fieldset(legend: string, hint?: string): HTMLFieldSetElement {
    const set = el("fieldset", "calc-set");
    set.append(el("legend", "", legend));
    if (hint) set.append(el("p", "hint", hint));
    return set;
}

// ---------- build the form ----------
const sites = rows.filter((r) => r.kind === "site");
const addons = rows.filter((r) => r.kind === "addon");
const hosts = rows.filter((r) => r.kind === "host");
const maint = rows.find((r) => r.kind === "maint");

// 1. what are you building
const siteSet = fieldset("1. What are you building?");
const select = el("select");
select.id = "calcSite";
select.name = "site";
select.setAttribute("aria-label", "What are you building?");
select.append(new Option("Choose a type of website", ""));
for (const group of [...new Set(sites.map((r) => r.group))]) {
    const og = el("optgroup");
    og.label = group;
    sites
        .filter((r) => r.group === group)
        .forEach((r) => og.append(new Option(`${r.name} (${range(r.lo, r.hi, r.plus)})`, r.name)));
    select.append(og);
}
siteSet.append(select);

// 2. extras
const addonSet = fieldset("2. Anything extra?", "Tick any that you need.");
const addonGrid = el("div", "calc-checks");
addons.forEach((r, i) => {
    const label = el("label", "calc-check");
    const box = el("input");
    box.type = "checkbox";
    box.name = "addon";
    box.value = r.name;
    box.id = `addon${i}`;
    const text = el("span", "");
    text.append(el("strong", "", r.name), el("small", "", range(r.lo, r.hi, r.plus)));
    label.append(box, text);
    addonGrid.append(label);
});
addonSet.append(addonGrid);

// 3. monthly
const monthSet = fieldset("3. Keeping it online", "Hosting and care are monthly.");
const monthGrid = el("div", "calc-checks");
const none = { name: "No hosting needed", lo: 0, hi: 0 };
[none, ...hosts].forEach((r, i) => {
    const label = el("label", "calc-check");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "host";
    radio.value = i === 0 ? "" : r.name;
    radio.checked = i === 0;
    const text = el("span", "");
    text.append(el("strong", "", r.name), el("small", "", i === 0 ? "Nothing monthly" : `${money(r.lo)} a month`));
    label.append(radio, text);
    monthGrid.append(label);
});
if (maint) {
    const label = el("label", "calc-check");
    const box = el("input");
    box.type = "checkbox";
    box.name = "maint";
    box.value = maint.name;
    const text = el("span", "");
    text.append(el("strong", "", maint.name), el("small", "", `${range(maint.lo, maint.hi, false)} a month`));
    label.append(box, text);
    monthGrid.append(label);
}
monthSet.append(monthGrid);

form.append(siteSet, addonSet, monthSet);

// ---------- maths ----------
function selected(): { site?: Row; extras: Row[]; host?: Row; care?: Row } {
    const data = new FormData(form);
    const siteName = String(data.get("site") ?? "");
    const picked = new Set(data.getAll("addon").map(String));
    const hostName = String(data.get("host") ?? "");
    return {
        site: sites.find((r) => r.name === siteName),
        extras: addons.filter((r) => picked.has(r.name)),
        host: hosts.find((r) => r.name === hostName),
        care: data.get("maint") && maint ? maint : undefined,
    };
}

function update(): void {
    const { site, extras, host, care } = selected();

    const once = [site, ...extras].filter((r): r is Row => Boolean(r));
    const lo = once.reduce((sum, r) => sum + r.lo, 0);
    const hi = once.reduce((sum, r) => sum + r.hi, 0);
    const plus = once.some((r) => r.plus);

    const monthly = [host, care].filter((r): r is Row => Boolean(r));
    const mlo = monthly.reduce((sum, r) => sum + r.lo, 0);
    const mhi = monthly.reduce((sum, r) => sum + r.hi, 0);

    onceOut.textContent = once.length ? range(lo, hi, plus) : "R0";
    monthlyOut.textContent = monthly.length ? range(mlo, mhi, false) : "R0";

    summary.replaceChildren(
        ...[
            ...(site ? [`${site.name}`] : []),
            ...extras.map((r) => `+ ${r.name}`),
            ...(host ? [`${host.name}, monthly`] : []),
            ...(care ? [`${care.name}, monthly`] : []),
        ].map((text) => el("li", "", text))
    );

    const lines: string[] = ["Hi Dilian, I'd like a quote for:"];
    if (site) lines.push(`- ${site.name} (${range(site.lo, site.hi, site.plus)})`);
    extras.forEach((r) => lines.push(`- Extra: ${r.name} (${range(r.lo, r.hi, r.plus)})`));
    if (host) lines.push(`- ${host.name} (${money(host.lo)} a month)`);
    if (care) lines.push(`- ${care.name} (${range(care.lo, care.hi, false)} a month)`);
    if (once.length) lines.push(`Estimated once-off: ${range(lo, hi, plus)}`);
    if (monthly.length) lines.push(`Estimated monthly: ${range(mlo, mhi, false)}`);
    lines.push("", "A bit about my project: ");

    const params = new URLSearchParams({
        subject: site ? `Quote: ${site.name}` : "Quote request",
        message: lines.join("\n"),
    });
    sendLink.href = `/get-in-touch.html?${params.toString()}`;
    sendLink.classList.toggle("is-disabled", once.length === 0 && monthly.length === 0);
}

form.addEventListener("change", update);
update();

// Only show the calculator when it can work (it needs JavaScript).
section.hidden = false;
const chip = document.getElementById("estimateChip");
if (chip) chip.hidden = false;
