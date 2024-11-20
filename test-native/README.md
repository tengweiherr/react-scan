## wip

1. build package

   npm build

2. turn into tarball

   npm pack

3. create an expo app and cd into it

   create npx create-expo-app@latest

4. install react-scan

   npm install ~the tarball made~

5. install react-native-skia

   npm install @shopify/react-native-skia

6. add react scan

```tsx
+ import {ReactNativeScanEntryPoint} from "react-scan/native"


....
  <ThemeProvider value={...}>
      <Stack>
      ...
      </Stack>
  +   <ReactNativeScanEntryPoint/>
  </ThemeProvider>
```

7. run on ios (requires simulator)

npm ios
