// Optional settings for whoever hosts this page. Everything works with this left as is:
// each visitor then connects with their own Spotify app from the setup screen.
window.LYRICS_CONFIG = {
  // Put your Spotify app's Client ID here to give visitors a one-tap "Connect Spotify"
  // button. A Client ID is not a secret. While your Spotify app is in development mode
  // it only works for you and up to five accounts you add under User Management.
  clientId: '',

  // How often to ask Spotify what is playing, in seconds.
  pollSeconds: 3,
};
