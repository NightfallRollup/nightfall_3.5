import { expect } from 'chai';
import hardhat from 'hardhat';

const { ethers } = hardhat;

describe('Verifier tests', function () {
  let VerifierInstance;
  beforeEach(async () => {
    const VerifierDeployer = await ethers.getContractFactory('Verifier');
    VerifierInstance = await VerifierDeployer.deploy();
    await VerifierInstance.deployed();
  });

  afterEach(async () => {
    // clear down the test network after each test
    await hardhat.network.provider.send('hardhat_reset');
  });

  describe('Test Verifier', () => {
    let verificationKey;
    let proof;
    let publicInputs;

    beforeEach(() => {
      verificationKey = [
        '20491192805390485299153009773594534940189261866228447918068658471970481763042',
        '9383485363053290200918347156157836566562967994039712273449902621266178545958',
        '1',
        '6375614351688725206403948262868962793625744043794305715222011528459656738731',
        '4252822878758300859123897981450591353533073413197771768651442665752259397132',
        '10505242626370262277552901082094356697409835680220590971873171140371331206856',
        '21847035105528745403288232691147584728191162732299865338377159692350059136679',
        '1',
        '0',
        '10857046999023057135944570762232829481370756359578518086990519993285655852781',
        '11559732032986387107991004021392285783925812861821192530917403151452391805634',
        '8495653923123431417604973247489272438418190587263600148770280649306958101930',
        '4082367875863433681332203403145435568316851327593401208105741076214120093531',
        '1',
        '0',
        '10857046999023057135944570762232829481370756359578518086990519993285655852781',
        '11559732032986387107991004021392285783925812861821192530917403151452391805634',
        '8495653923123431417604973247489272438418190587263600148770280649306958101930',
        '4082367875863433681332203403145435568316851327593401208105741076214120093531',
        '1',
        '0',
        '2029413683389138792403550203267699914886160938906632433982220835551125967885',
        '21072700047562757817161031222997517981543347628379360635925549008442030252106',
        '5940354580057074848093997050200682056184807770593307860589430076672439820312',
        '12156638873931618554171829126792193045421052652279363021382169897324752428276',
        '7898200236362823042373859371574133993780991612861777490112507062703164551277',
        '7074218545237549455313236346927434013100842096812539264420499035217050630853',
        '7077479683546002997211712695946002074877511277312570035766170199895071832130',
        '10093483419865920389913245021038182291233451549023025229112148274109565435465',
        '4595479056700221319381530156280926371456704509942304414423590385166031118820',
        '19831328484489333784475432780421641293929726139240675179672856274388269393268',
        '11934129596455521040620786944827826205713621633706285934057045369193958244500',
        '8037395052364110730298837004334506829870972346962140206007064471173334027475',
        '6077772317674035361191519900458539758275782473828422742336150895275597006416',
        '2660949526876845336934205063316646912789015817073092503500593317043579623823',
        '1',
        '9355165092241845587760551298554406697810239285365566649795688076749087801707',
        '15386678631788882766737782099472575315029904094060229967423490210257954115126',
        '1',
        '16640671282593957790342588551071327830384251608607653396889336115855440295786',
        '21445567458624070741196181640447796089522321014087710746556860587785750351901',
        '1',
        '15731523570958816177422235072129648326462208599749359530435742189371781277792',
        '18407847337105687131378889124027320972743565031748621694047894986171412011763',
        '1',
        '19710676771667462915558146412300767733248493434966580251749985437909720597474',
        '11106963883298300057141931449217758520582913107940235600772654143050046483743',
        '1',
        '12457093104890754422213524902564075577340748245247220794340658905182951148172',
        '21082634453437294401900338816002325573824752204412374704877115143397380916800',
        '1',
        '19417676533633488943954906476121879301727244452261317841788918240099351054880',
        '16965372344073783184513569862302769213258897631119596341098252773516716402006',
        '1',
        '2676411041129181857625094154174285740519076646962790595921068090761926666231',
        '3175155076407201650284504943896026418915259001384008997029686095679904258775',
        '1',
        '10492825578923860484808036239316740679921015171325130264944573887967060781374',
        '1166016140313130734691467953384726371682040464191851462293398425575313469694',
        '1',
        '9363047358547639053485226913567094145651003884645077925062727798372954409803',
        '8482890749780845263263287986395260948339862637937026637637216322252987730343',
        '1',
        '15361190303205516365971900889307416311749146657815872717650095580987874896503',
        '2852510228605810081910986620883665516147268044951865327320217590022649139407',
        '1',
        '17298509516245356283351042983190666753036150337293374836437810242906769336669',
        '19425384408830091894933122899202698337026749575970790786338037330783259064516',
        '1',
        '1190549776256446355209176175059542393009676765434603437333314017970948133591',
        '8709420652844418957138531731626865586148576916984446801112042936202206799439',
        '1',
        '19116006291048369566129754764814278615186129777391327190522670220370055081783',
        '21148864853707421731487185591590152622503672320554653360695090267506448951162',
        '1',
        '11003815236448626137524368726094211937938689688913662992005222122714283533399',
        '55481056296355069044704405565465180550707559897168165801839555626751093276',
        '1',
        '7501696089493996494748279296148165550718399436942494860783445823180223435498',
        '13689452876217356882835385517098535617310291611322626842432978303866444677182',
        '1',
        '9514834343941975482541766473805775350922666632446000390748107449665790454912',
        '3098191101694324970532005417021395636402824751305649030914000850590834773070',
        '1',
        '21513176627684252729013813393749607640759489919872211766149796913884850575830',
        '10680282925582475489990994133503993330361360746187795882973563384941002423248',
        '1',
        '8248525528220120414365718260200516365449933268158343554433083682845792129924',
        '15643707725348817563985557140246388150772520475287633840522673359178760722575',
        '1',
      ];

      publicInputs = [
        10,
        0,
        0,
        0,
        1319533947831612348694315757168650042041713553662n,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        12746073479277687257238502437156289853387712854052245283820868114393764230380n,
        0,
        0,
        1319533947831612348694315757168650042041713553662n,
      ];

      proof = [
        '0x188cd16e9605273e865ad2143c2f501f1c2d63e6306bf278e57c8b7bdcc1a9de',
        '0x2c88c67dac71115253eec575c0d71076ad30a3a2d6e0bbe0e1a3c733b9dec929',
        '0x2ea3f5151865ef35bc35f234aea859261dc0a1a1880999f1770babe76f4e21b7',
        '0x2ed520ff2d7a144d2c48eced91e5cc721fd3d8abb0fb8b3bbfc8e553bafc4fac',
        '0x13768eba01e0b9e193fd8899a9c35054ae33e4f98dae5ccc67c3129d1366ab98',
        '0x0993f3dba4a46affff3d77a6812b3bbdbb2b61b95dd97f420ec75e8787d303be',
        '0x19e62e0cca9c2ebdf74a3bce853a047757c80c4a3c665b23710180504811748c',
        '0x00a7ac6ac480eab94ff253507f1f01204daa88329f83a5086a4a1b55ef2ec3e1',
      ];
    });

    it('Checks that the deposit is verified correctly', async () => {
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(true);
    });

    it('Fails if verification Key has invalid length', async () => {
      verificationKey.pop();
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });

    it('Fails if verification key is an empty array', async () => {
      expect(await VerifierInstance.verify(proof, publicInputs, [])).to.equal(false);
    });

    it('Fails if verification key length is smaller than 33', async () => {
      const fakeVerificationKey = [
        '3098191101694324970532005417021395636402824751305649030914000850590834773070',
        '9514834343941975482541766473805775350922666632446000390748107449665790454912',
      ];
      expect(await VerifierInstance.verify(proof, publicInputs, fakeVerificationKey)).to.equal(
        false,
      );
    });

    it('Fails if verification key has length 33', async () => {
      const fakeVerificationKey = Array(33).fill(
        '3098191101694324970532005417021395636402824751305649030914000850590834773070',
      );
      expect(await VerifierInstance.verify(proof, publicInputs, fakeVerificationKey)).to.equal(
        false,
      );
    });

    it('Fails if proof length is invalid', async () => {
      proof.pop();
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });

    it('Fails if proof A is not a G1 point', async () => {
      proof[0] = '1';
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });

    it('Fails if proof C is not a G1 point', async () => {
      proof[7] = '1';
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });

    it('Fails if proof B is not a G2 point', async () => {
      proof[4] = '1';
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });

    it('Fails if input any public input is higher than BN128 order', async () => {
      publicInputs[0] = 2n ** 254n;
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });

    it('Fails if verification fails', async () => {
      publicInputs[0] = 100;
      expect(await VerifierInstance.verify(proof, publicInputs, verificationKey)).to.equal(false);
    });
  });
});
