export const siteLinks: {
  instagram: { handle: string; url: string };
  email: string;
  venmo: { handle: string; url: string };
  /** Replace with in-app booking URL when it ships. Null renders a /signup fallback. */
  booking: string | null;
} = {
  instagram: {
    handle: "@swimcoach_jason",
    url: "https://instagram.com/swimcoach_jason",
  },
  /** Swap for a business address before launch */
  email: "jasonalcidesguzman@gmail.com",
  venmo: {
    handle: "@Jason-Guzman-18",
    url: "https://venmo.com/u/Jason-Guzman-18",
  },
  booking: null,
};
