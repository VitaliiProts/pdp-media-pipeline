let signedIn = false;

/** The session cookie the MSW gateway would hold; reset after every test. */
export const testSession = {
  signIn: () => {
    signedIn = true;
  },
  signOut: () => {
    signedIn = false;
  },
  isSignedIn: () => signedIn,
};
