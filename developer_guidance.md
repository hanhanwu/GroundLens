# Developer Guidance


## Setup
* `brew install node`, manages JS packages
  * verify `node -v`
  * verify `npm -v`
* Run `npm install -g expo-cli` to install the Expo CLI, a tool that helps developers create, develop, and manage React Native projects using the Expo framework.
* Run `npx create-expo-app frontend --template blank`, this creates "frontend/" folder
  * this should also do `npm install` automatically
* `cd frontend` --> `npx expo install react-dom react-native-web`
* Create virtual env in Visual Studio Code
* `cd backend`
  * `pip install -r requirements.txt`
* Add environment variables to `~/.zshrc`
  * `export GROQ_API_KEY=gsk_your_key_here`
  * Then in the terminal, type `source ~/.zshrc`

## Test Local Website
* `source .venv/bin/activate` to activate the virtual env if it's not activated
* After main.py had been implemented, `python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` to start FastAPI server
  * if something is already running om port 8000
    * `lsof -i :8000` --> `kill <PID>`
  * Backend console will show printed results
* `cd frontend`
  * `npx expo start --web` will start the web 🚀