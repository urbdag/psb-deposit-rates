/** Format a Rupee amount into Indian-style short form (lakh / crore). */
export function formatINR(amount) {
    if (amount >= 10000000) {
        const cr = amount / 10000000;
        return `₹${trimZeros(cr)} cr`;
    }
    if (amount >= 100000) {
        const l = amount / 100000;
        return `₹${trimZeros(l)} lakh`;
    }
    return `₹${amount.toLocaleString("en-IN")}`;
}
function trimZeros(n) {
    return Number.isInteger(n)
        ? String(n)
        : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
export function formatRate(rate) {
    return `${rate.toFixed(2)}%`;
}
export function formatTenureDays(days) {
    if (days % 365 === 0) {
        const y = days / 365;
        return `${y} year${y > 1 ? "s" : ""}`;
    }
    if (days >= 30 && days % 30 === 0) {
        const m = days / 30;
        return `${m} month${m > 1 ? "s" : ""}`;
    }
    return `${days} days`;
}
export function productLabel(p) {
    switch (p) {
        case "FD":
            return "Fixed Deposit";
        case "SAVINGS":
            return "Savings Account";
        case "RD":
            return "Recurring Deposit";
    }
}
export function amountLabel(a) {
    return a.label;
}
export function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime()))
        return iso;
    return d.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}
