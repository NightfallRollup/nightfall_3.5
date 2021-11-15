const ERC20Mock = artifacts.require('ERC20Mock.sol');
const ERC721Mock = artifacts.require('ERC721Mock.sol');
const ERC1155Mock = artifacts.require('ERC1155Mock.sol');

const recipientAddress = '0x9c8b2276d490141ae1440da660e470e7c0349c63'; 
const walletTestAddress = '0xDd369AF1Bd4D8fEBEf2cE1716AfEC592e00553AA'; 

module.exports = function(deployer) {
  deployer.then(async () => {
    await deployer.deploy(ERC20Mock, 100000000000); // initialSupply
    await deployer.deploy(ERC721Mock);
    await deployer.deploy(ERC1155Mock);
    
    const ERC20deployed = await ERC20Mock.deployed();
    const ERC721deployed = await ERC721Mock.deployed();
    const ERC1155deployed = await ERC1155Mock.deployed();
    // For e2e tests
    await ERC721deployed.awardItem(recipientAddress, 'https://erc721mock/item-id-1.json');
    await ERC721deployed.awardItem(recipientAddress, 'https://erc721mock/item-id-2.json');
    await ERC721deployed.awardItem(recipientAddress, 'https://erc721mock/item-id-3.json');
    // For testing the wallet
    await ERC20deployed.transfer(walletTestAddress, 1000000);
    await ERC721deployed.awardItem(walletTestAddress, 'https://erc721mock/item-id-1.json');
    await ERC721deployed.awardItem(walletTestAddress, 'https://erc721mock/item-id-2.json');
    await ERC721deployed.awardItem(walletTestAddress, 'https://erc721mock/item-id-3.json');
    await ERC1155deployed.safeBatchTransferFrom(recipientAddress, walletTestAddress, [0, 1, 4], 
      [5000000, 200000, 100000], []); 
    });
};