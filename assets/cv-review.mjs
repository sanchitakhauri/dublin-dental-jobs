export const permissionLine = "Work authorisation: Eligible to work in Ireland under current Stamp 1G permission; no employment permit required for employee roles.";

export function reviewCV(text, role) {
  if (!text.trim()) return [];
  const support = role === "support";
  const content = text.replace(/[\s\u00a0]+/g, " ");
  const has = (pattern) => pattern.test(content);
  const suggestions = [];

  if (!has(/\bwork authori[sz]ation\b|\bstamp\s*1g\b|\bright to work\b|\bemployment permit\b/i)) {
    suggestions.push({
      title: "Put verified work authorisation near the top",
      advice: "If you hold current Stamp 1G permission that allows employment, state that no employment permit is needed for employee roles. Leave out IRP numbers and family details.",
      insert: permissionLine,
    });
  } else {
    suggestions.push({
      title: "Keep the work-authorisation line",
      advice: "Use one short line near your contact details. If applicable, say no employment permit is required for employee roles, rather than describing your family's permissions.",
    });
  }

  if (support) {
    suggestions.push({
      title: "Lead with the dental role you want",
      advice: "Use the advert's title in your headline (for example, 'Dental Assistant Candidate | BDS'), not a broad medical or aesthetics headline. Keep the title of each past job accurate.",
    });
    const strengths = [
      [/\bsterili[sz]\w+|\binfection[- ]prevention|\bdecontamination/i, "sterilisation and infection prevention"],
      [/\btreatment[- ]room\b|\binstruments?\b/i, "treatment-room and instrument preparation"],
      [/\b(?:clinical notes|documentation|patient records)\b/i, "clinical documentation"],
      [/\b(?:oral hygiene|aftercare|patient education)\b/i, "patient education and aftercare"],
    ].filter(([pattern]) => has(pattern)).map(([, strength]) => strength);
    suggestions.push({
      title: "Bring relevant dental experience forward",
      advice: strengths.length
        ? `Your draft mentions ${strengths.join(", ")}. Move these into the first few dental experience bullets and back them up with specific, accurate examples.`
        : "If you have done them, describe specific examples of instrument preparation, infection prevention, patient records or patient support. Don't claim duties you haven't performed.",
    });
    if (has(/\baesthetic\w*|\bcosmetolog\w*|\bbotox\b|\bmicroneedl\w*/i)) {
      suggestions.push({
        title: "Shorten the aesthetics section",
        advice: "Keep the job title and dates. Use two or three bullets about transferable work such as treatment-room setup, records, patient communication and follow-up, rather than a list of cosmetic procedures.",
      });
    }
    suggestions.push({
      title: "Check qualifications against the advert",
      advice: "List any verified nursing training, chairside assistance or instrument processing experience the employer requests. A BDS is not a dental-nursing qualification; ask how the employer assesses it. Don't imply permission to take radiographs.",
    });
  } else {
    suggestions.push({
      title: "State your Irish Dental Council status accurately",
      advice: "If registered in Ireland, list your actual registration status. If it is pending or not started, say so plainly and check the route for an overseas qualification. Do not use 'Irish-registered dentist' until confirmed.",
    });
    suggestions.push({
      title: "Use a dentist-specific experience section",
      advice: "Put dental consultations, treatment planning, the procedures you actually performed, and patient outcomes first. Include your BDS institution and graduation year if verified. Keep non-dental experience brief.",
    });
    suggestions.push({
      title: "Ask about the contract",
      advice: "Some associate dentist posts are self-employed. Check your permission and confirm the working arrangement with the employer before relying on the role.",
    });
  }

  suggestions.push({
    title: "Use a simple, readable layout",
    advice: "Use one column with clear headings for Experience, Skills and Education. Add month/year dates and, where accurate, volume or outcomes. Keep contact details separate from the body and avoid scanned text.",
  });
  return suggestions;
}
